package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type adminEmailTestMailer struct {
	recipient string
	err       error
}

func (m *adminEmailTestMailer) SendCode(_, _, _ string) error { return nil }

func (m *adminEmailTestMailer) SendTest(to string) error {
	m.recipient = to
	return m.err
}

func TestSendTestEmailAdmin(t *testing.T) {
	mailer := &adminEmailTestMailer{}
	d := Deps{Mailer: mailer}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/settings/email/test", strings.NewReader(`{"email":" Admin@Example.Test "}`))
	rec := httptest.NewRecorder()
	sendTestEmailAdmin(d, rec, req)
	if rec.Code != http.StatusOK || mailer.recipient != "admin@example.test" {
		t.Fatalf("status=%d body=%s recipient=%q", rec.Code, rec.Body.String(), mailer.recipient)
	}
}

func TestSendTestEmailAdminRejectsInvalidAddressAndReportsSMTPFailure(t *testing.T) {
	mailer := &adminEmailTestMailer{err: errors.New("SMTP unavailable")}
	d := Deps{Mailer: mailer}

	invalidReq := httptest.NewRequest(http.MethodPost, "/api/admin/settings/email/test", strings.NewReader(`{"email":"invalid"}`))
	invalidRec := httptest.NewRecorder()
	sendTestEmailAdmin(d, invalidRec, invalidReq)
	if invalidRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid email status=%d body=%s", invalidRec.Code, invalidRec.Body.String())
	}

	failReq := httptest.NewRequest(http.MethodPost, "/api/admin/settings/email/test", strings.NewReader(`{"email":"admin@example.test"}`))
	failRec := httptest.NewRecorder()
	sendTestEmailAdmin(d, failRec, failReq)
	if failRec.Code != http.StatusBadGateway || !strings.Contains(failRec.Body.String(), errEmailTestFailed.Error()) {
		t.Fatalf("SMTP failure status=%d body=%s", failRec.Code, failRec.Body.String())
	}
}
