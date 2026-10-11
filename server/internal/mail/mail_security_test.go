package mail

import (
	"bytes"
	"log"
	"path/filepath"
	"strings"
	"testing"

	"aivory/server/internal/config"
	"aivory/server/internal/store"
)

func TestSendCodeNeverLogsVerificationSecretWhenSMTPIsUnavailable(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "mail-security.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := store.Migrate(db); err != nil {
		t.Fatal(err)
	}
	if err := store.Seed(db, config.Config{}); err != nil {
		t.Fatal(err)
	}
	store.InvalidateConfig()
	var logs bytes.Buffer
	sender := NewSMTPSender(db, log.New(&logs, "", 0))
	err = sender.SendCode("victim@example.test", "123456", "reset")
	if err == nil {
		t.Fatal("SendCode succeeded without SMTP configuration")
	}
	if strings.Contains(logs.String(), "123456") {
		t.Fatalf("SMTP failure leaked verification code to logs: %s", logs.String())
	}
}

func TestSMTPSenderRejectsMalformedConfiguration(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "mail-malformed.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := store.Migrate(db); err != nil {
		t.Fatal(err)
	}
	if err := store.Seed(db, config.Config{}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE settings SET value='not-json' WHERE key='smtp_tls'`); err != nil {
		t.Fatal(err)
	}
	store.InvalidateConfig()
	sender := NewSMTPSender(db, log.New(&bytes.Buffer{}, "", 0))
	if err := sender.SendCode("victim@example.test", "654321", "verify"); err == nil {
		t.Fatal("SendCode accepted malformed SMTP configuration")
	}
}

func TestVerificationEmailUsesChineseCopyWithoutLogo(t *testing.T) {
	html, err := renderEmail(emailData{
		Heading:  "验证你的邮箱",
		Body:     "请使用下方验证码完成邮箱验证。",
		Code:     "123456",
		Year:     2026,
		SiteName: "测试站点",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"lang=\"zh-CN\"", "验证你的邮箱", "验证码将在 10 分钟后失效", "测试站点"} {
		if !strings.Contains(html, expected) {
			t.Fatalf("email template is missing %q", expected)
		}
	}
	if strings.Contains(html, "linear-gradient(135deg") {
		t.Fatal("email template still contains the decorative logo")
	}
}
