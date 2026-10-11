package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"aivory/server/internal/store"
)

func TestSiteConfigPublicDefaultsAndOverrides(t *testing.T) {
	db := openMigrated(t, filepath.Join(t.TempDir(), "site-config.db"))
	defer db.Close()
	d := Deps{DB: db}

	read := func() publicSiteConfig {
		t.Helper()
		store.InvalidateConfig()
		rec := httptest.NewRecorder()
		siteConfigPublicHandler(d, rec, httptest.NewRequest(http.MethodGet, "/api/public/site-config", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
		}
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if len(raw) != 2 {
			t.Fatalf("public site response exposed unexpected fields: %s", rec.Body.String())
		}
		var got publicSiteConfig
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		return got
	}

	if got := read(); got.Title != defaultSiteTitle || got.Description != defaultSiteDescription {
		t.Fatalf("defaults = %+v", got)
	}
	if err := store.SetSetting(db, "site_title", "  千问  "); err != nil {
		t.Fatal(err)
	}
	if err := store.SetSetting(db, "site_description", "  私有 AI 工作台  "); err != nil {
		t.Fatal(err)
	}
	if got := read(); got.Title != "千问" || got.Description != "私有 AI 工作台" {
		t.Fatalf("configured response = %+v", got)
	}
}

func TestAdminSiteSettingsValidation(t *testing.T) {
	db := openMigrated(t, filepath.Join(t.TempDir(), "site-settings-validation.db"))
	defer db.Close()
	d := Deps{DB: db}

	for _, body := range []string{
		`{"site_title":""}`,
		`{"site_title":"bad\nname"}`,
		`{"site_title":"` + strings.Repeat("x", maxSiteTitleRunes+1) + `"}`,
		`{"site_description":"` + strings.Repeat("x", maxSiteDescriptionRunes+1) + `"}`,
	} {
		req := httptest.NewRequest(http.MethodPatch, "/api/admin/settings", strings.NewReader(body))
		req.Header.Set("content-type", "application/json")
		rec := httptest.NewRecorder()
		adminSettingsSet(d, rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body=%s status=%d, want %d; response=%s", body, rec.Code, http.StatusBadRequest, rec.Body.String())
		}
	}

	req := httptest.NewRequest(http.MethodPatch, "/api/admin/settings", strings.NewReader(`{"site_title":"  千问  ","site_description":"  私有 AI 工作台  "}`))
	req.Header.Set("content-type", "application/json")
	rec := httptest.NewRecorder()
	adminSettingsSet(d, rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid patch status=%d body=%s", rec.Code, rec.Body.String())
	}
}
