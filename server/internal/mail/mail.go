// Package mail provides a small SMTP sender that reads its configuration
// from admin settings (live-reloaded on each send — no restart required).
//
// The HTML template is inline to keep the deployment to a single binary;
// it uses the Aivory brand palette via CSS variables that we compile to
// literal values at render time so the HTML works in any email client.
package mail

import (
	"bytes"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"

	"aivory/server/internal/store"
)

// Sender is the surface the auth handlers use. Implementations must be safe
// for concurrent use.
type Sender interface {
	SendCode(to, code, purpose string) error
}

// TestSender is implemented by mailers that can verify delivery settings with
// a human-readable message instead of generating an authentication code.
type TestSender interface {
	SendTest(to string) error
}

// smtpConfig is the resolved SMTP config read from admin settings.
type smtpConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	From     string
	TLS      bool
	SiteName string
}

// SMTPSender reads SMTP config from admin settings on every send so changes
// in the admin UI take effect immediately without a restart.
type SMTPSender struct {
	DB     *sql.DB
	Logger *log.Logger
}

// NewSMTPSender creates a new sender backed by admin-configurable SMTP.
func NewSMTPSender(db *sql.DB, logger *log.Logger) *SMTPSender {
	return &SMTPSender{DB: db, Logger: logger}
}

func (s *SMTPSender) loadConfig() (smtpConfig, error) {
	var cfg smtpConfig
	readStr := func(key string) (string, error) {
		raw, err := store.GetSetting(s.DB, key)
		if err != nil {
			return "", fmt.Errorf("read %s: %w", key, err)
		}
		var v string
		if err := json.Unmarshal(raw, &v); err != nil {
			return "", fmt.Errorf("decode %s: %w", key, err)
		}
		return strings.TrimSpace(v), nil
	}
	readBool := func(key string) (bool, error) {
		raw, err := store.GetSetting(s.DB, key)
		if err != nil {
			return false, fmt.Errorf("read %s: %w", key, err)
		}
		var v bool
		if err := json.Unmarshal(raw, &v); err != nil {
			return false, fmt.Errorf("decode %s: %w", key, err)
		}
		return v, nil
	}
	var err error
	if cfg.Host, err = readStr("smtp_host"); err != nil {
		return cfg, err
	}
	if cfg.Port, err = readStr("smtp_port"); err != nil {
		return cfg, err
	}
	if cfg.User, err = readStr("smtp_user"); err != nil {
		return cfg, err
	}
	if cfg.Password, err = readStr("smtp_password"); err != nil {
		return cfg, err
	}
	if cfg.From, err = readStr("smtp_from"); err != nil {
		return cfg, err
	}
	if cfg.TLS, err = readBool("smtp_tls"); err != nil {
		return cfg, err
	}
	cfg.SiteName = "Aivory"
	if siteName, siteErr := readStr("site_title"); siteErr == nil && siteName != "" {
		cfg.SiteName = siteName
	}
	if cfg.Host == "" {
		return cfg, fmt.Errorf("smtp_host is not configured")
	}
	if cfg.Port == "" {
		cfg.Port = "587"
	}
	if cfg.From == "" {
		cfg.From = cfg.User
	}
	return cfg, nil
}

// SendCode sends a branded HTML email with a 6-digit verification code.
// purpose is one of "verify" | "reset" — controls the subject line and body text.
func (s *SMTPSender) SendCode(to, code, purpose string) error {
	cfg, err := s.loadConfig()
	if err != nil {
		// Never place a verification or reset secret in logs. In particular, a
		// missing SMTP host must not turn the application log into a password-reset
		// mailbox. Callers return a generic response where appropriate and can retry
		// after an administrator fixes SMTP.
		return fmt.Errorf("load SMTP configuration: %w", err)
	}

	subject := "邮箱验证码"
	heading := "验证你的邮箱"
	body := "请使用验证码完成邮箱验证，验证码将在 10 分钟后失效。"
	if purpose == "reset" {
		subject = "密码重置验证码"
		heading = "重置你的密码"
		body = "请使用下方验证码重置密码，验证码将在 10 分钟后失效。"
	}

	html, err := renderEmail(emailData{
		Heading:  heading,
		Body:     body,
		Code:     code,
		Year:     time.Now().Year(),
		SiteName: cfg.SiteName,
	})
	if err != nil {
		return fmt.Errorf("render email: %w", err)
	}

	return s.send(cfg, to, subject, html)
}

// SendTest verifies the currently saved SMTP settings by sending a message the
// administrator can identify without creating an authentication code.
func (s *SMTPSender) SendTest(to string) error {
	cfg, err := s.loadConfig()
	if err != nil {
		return fmt.Errorf("load SMTP configuration: %w", err)
	}
	html, err := renderEmail(emailData{
		Heading:  "邮件服务配置成功",
		Body:     "这封测试邮件用于确认 SMTP 服务器已成功接收来自 " + cfg.SiteName + " 的邮件。",
		Year:     time.Now().Year(),
		SiteName: cfg.SiteName,
	})
	if err != nil {
		return fmt.Errorf("render email: %w", err)
	}
	return s.send(cfg, to, "SMTP 测试邮件", html)
}

func (s *SMTPSender) send(cfg smtpConfig, to, subject, htmlBody string) error {
	addr := net.JoinHostPort(cfg.Host, cfg.Port)

	// Build the raw MIME message.
	var msg bytes.Buffer
	msg.WriteString("From: " + cfg.From + "\r\n")
	msg.WriteString("To: " + to + "\r\n")
	msg.WriteString("Subject: " + mime.QEncoding.Encode("UTF-8", subject) + "\r\n")
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	msg.WriteString("Date: " + time.Now().UTC().Format(time.RFC1123Z) + "\r\n")
	msg.WriteString("\r\n")
	msg.WriteString(htmlBody)

	auth := smtp.PlainAuth("", cfg.User, cfg.Password, cfg.Host)
	tlsCfg := &tls.Config{ServerName: cfg.Host}

	// Bound EVERY network step. The standard library's tls.Dial / smtp.SendMail
	// have NO timeout, so a wrong port or a TLS-mode mismatch (587 expects
	// STARTTLS, 465 expects implicit TLS) hangs forever — which froze the
	// register request on an infinite spinner. A 10s dial + a 25s overall
	// deadline make a misconfigured server fail fast instead.
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	deadline := time.Now().Add(25 * time.Second)

	var c *smtp.Client
	if cfg.TLS || cfg.Port == "465" {
		// Implicit TLS (port 465): the connection is TLS from the first byte.
		conn, err := tls.DialWithDialer(dialer, "tcp", addr, tlsCfg)
		if err != nil {
			return fmt.Errorf("tls dial: %w", err)
		}
		_ = conn.SetDeadline(deadline)
		c, err = smtp.NewClient(conn, cfg.Host)
		if err != nil {
			_ = conn.Close()
			return fmt.Errorf("smtp client: %w", err)
		}
	} else {
		// Plain connect, then upgrade with STARTTLS when the server offers it
		// (port 587 / 25). Auto-detect so the common 587 setup just works.
		conn, err := dialer.Dial("tcp", addr)
		if err != nil {
			return fmt.Errorf("dial: %w", err)
		}
		_ = conn.SetDeadline(deadline)
		c, err = smtp.NewClient(conn, cfg.Host)
		if err != nil {
			_ = conn.Close()
			return fmt.Errorf("smtp client: %w", err)
		}
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(tlsCfg); err != nil {
				_ = c.Close()
				return fmt.Errorf("starttls: %w", err)
			}
		}
	}
	defer c.Close()

	// Authenticate only when credentials are set AND the server advertises AUTH.
	if cfg.User != "" {
		if ok, _ := c.Extension("AUTH"); ok {
			if err := c.Auth(auth); err != nil {
				return fmt.Errorf("smtp auth: %w", err)
			}
		}
	}
	if err := c.Mail(cfg.From); err != nil {
		return fmt.Errorf("smtp mail: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(msg.Bytes()); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp write close: %w", err)
	}
	return c.Quit()
}

type emailData struct {
	Heading  string
	Body     string
	Code     string
	Year     int
	SiteName string
}

var emailTmpl = template.Must(template.New("email").Parse(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F6F5FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F6F5FA;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="460" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:18px;border:1px solid #E4E2EC;overflow:hidden;">
  <!-- Header -->
  <tr><td style="padding:32px 36px 20px;text-align:center;">
    <h1 style="margin:0;font-size:22px;font-weight:600;color:#1B1830;letter-spacing:-0.02em;">{{.Heading}}</h1>
    <p style="margin:12px 0 0;font-size:14px;color:#5F5677;line-height:1.6;">{{.Body}}</p>
  </td></tr>
  {{if .Code}}<!-- Code -->
  <tr><td style="padding:8px 36px 28px;text-align:center;">
    <div style="display:inline-block;background-color:#F6F5FA;border:2px solid #E4E2EC;border-radius:14px;padding:18px 40px;letter-spacing:0.35em;font-size:32px;font-weight:700;color:#1B1830;font-family:'SF Mono',Monaco,Consolas,monospace;">
      {{.Code}}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#8C87A0;">验证码将在 10 分钟后失效，请勿向任何人透露。</p>
  </td></tr>
  {{else}}
  <tr><td style="padding:8px 36px 28px;text-align:center;">
    <div style="display:inline-block;background-color:#ECF8F2;border:1px solid #BDE5D2;border-radius:14px;padding:14px 24px;font-size:14px;font-weight:600;color:#237A57;">
      SMTP 连接成功
    </div>
  </td></tr>
  {{end}}
  <!-- Divider -->
  <tr><td style="padding:0 36px;"><div style="height:1px;background-color:#E4E2EC;"></div></td></tr>
  <!-- Footer -->
  <tr><td style="padding:20px 36px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#8C87A0;">
      &copy; {{.Year}} {{.SiteName}} &middot; 此邮件由系统自动发送，请勿直接回复。
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`))

func renderEmail(data emailData) (string, error) {
	var buf bytes.Buffer
	if err := emailTmpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// CheckDomainWhitelist validates that the email's domain is in the admin-configured
// whitelist. An empty whitelist means all domains are allowed.
func CheckDomainWhitelist(db *sql.DB, email string) error {
	email, err := store.NormalizeUserEmail(email)
	if err != nil {
		return fmt.Errorf("invalid email: %w", err)
	}
	raw, err := store.GetSetting(db, "email_domain_whitelist")
	if err != nil {
		return fmt.Errorf("read email domain whitelist: %w", err)
	}
	var whitelist string
	if err := json.Unmarshal(raw, &whitelist); err != nil {
		return fmt.Errorf("decode email domain whitelist: %w", err)
	}
	whitelist = strings.TrimSpace(whitelist)
	if whitelist == "" {
		return nil // empty = allow all
	}

	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid email")
	}
	domain := strings.ToLower(parts[1])

	for _, raw := range strings.FieldsFunc(whitelist, func(r rune) bool {
		return r == ',' || r == ';' || r == ' ' || r == '\n'
	}) {
		allowed := strings.ToLower(strings.TrimSpace(raw))
		allowed = strings.TrimPrefix(allowed, "@")
		if allowed == domain {
			return nil
		}
	}
	return fmt.Errorf("email domain @%s is not allowed", domain)
}
