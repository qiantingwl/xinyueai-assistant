package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"aivory/server/internal/store"
)

func TestAdminAuthPolicyIsNotMaskedAndIgnoresLegacyMask(t *testing.T) {
	d := newAuthSecurityDeps(t, "auth-policy-mask.db")
	admin, err := store.CreateUserWithRole(t.Context(), d.DB, "admin@example.test", "Admin", "hash", "admin")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetSetting(d.DB, "oauth_initial_password_policy", "optional"); err != nil {
		t.Fatal(err)
	}

	getRec := httptest.NewRecorder()
	adminSettingsGet(d, getRec, httptest.NewRequest(http.MethodGet, "/api/admin/settings", nil))
	if getRec.Code != http.StatusOK {
		t.Fatalf("get settings status=%d body=%s", getRec.Code, getRec.Body.String())
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(getRec.Body.Bytes(), &settings); err != nil {
		t.Fatal(err)
	}
	var policy string
	if err := json.Unmarshal(settings["oauth_initial_password_policy"], &policy); err != nil || policy != "optional" {
		t.Fatalf("oauth password policy = %q, err=%v", policy, err)
	}

	patch := httptest.NewRequest(http.MethodPatch, "/api/admin/settings", strings.NewReader(`{
		"oauth_initial_password_policy":"••••••",
		"signup_open":false
	}`))
	patch.Header.Set("Content-Type", "application/json")
	patch = patch.WithContext(context.WithValue(patch.Context(), userCtxKey{}, admin))
	patchRec := httptest.NewRecorder()
	adminSettingsSet(d, patchRec, patch)
	if patchRec.Code != http.StatusOK {
		t.Fatalf("save settings with legacy mask status=%d body=%s", patchRec.Code, patchRec.Body.String())
	}
	var signupOpen bool
	if raw, err := store.GetSetting(d.DB, "signup_open"); err != nil || json.Unmarshal(raw, &signupOpen) != nil || signupOpen {
		t.Fatalf("signup_open = %s, err=%v", raw, err)
	}
	if raw, err := store.GetSetting(d.DB, "oauth_initial_password_policy"); err != nil || json.Unmarshal(raw, &policy) != nil || policy != "optional" {
		t.Fatalf("oauth password policy after masked patch = %s, err=%v", raw, err)
	}
}

func TestEnterpriseAuthPolicyAllowsRequiredPasswordAndProtectsProvider(t *testing.T) {
	d := newAuthSecurityDeps(t, "enterprise-auth-policy.db")
	admin, err := store.CreateUserWithRole(t.Context(), d.DB, "admin@example.test", "Admin", "hash", "admin")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := store.CreateOAuthProvider(t.Context(), d.DB, store.OAuthProvider{
		ID: "oa_enterprise", Kind: "google", Name: "Company login", ClientID: "client-id", Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.BindOAuthIdentity(t.Context(), d.DB, provider.ID, "admin-subject", admin.ID, admin.Email); err != nil {
		t.Fatal(err)
	}

	patch := httptest.NewRequest(http.MethodPatch, "/api/admin/settings", strings.NewReader(`{
		"password_login_enabled": false,
		"auth_entry_mode": "provider_picker",
		"oauth_initial_password_policy": "required"
	}`))
	patch.Header.Set("Content-Type", "application/json")
	patch = patch.WithContext(context.WithValue(patch.Context(), userCtxKey{}, admin))
	patchRec := httptest.NewRecorder()
	adminSettingsSet(d, patchRec, patch)
	if patchRec.Code != http.StatusOK {
		t.Fatalf("save enterprise policy status=%d body=%s", patchRec.Code, patchRec.Body.String())
	}

	mx := newMux()
	mx.handle(http.MethodDelete, "/api/admin/oauth-providers/:id", wrap(d, deleteOAuthProviderAdmin))
	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/admin/oauth-providers/"+provider.ID, nil)
	deleteReq = deleteReq.WithContext(context.WithValue(deleteReq.Context(), userCtxKey{}, admin))
	deleteRec := httptest.NewRecorder()
	mx.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusConflict || !strings.Contains(deleteRec.Body.String(), errAuthPolicyProviderRequired.Error()) {
		t.Fatalf("delete required provider status=%d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
	if _, err := store.GetOAuthProvider(t.Context(), d.DB, provider.ID); err != nil {
		t.Fatalf("required provider was deleted: %v", err)
	}
}
