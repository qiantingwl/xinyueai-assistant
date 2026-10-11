package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"aivory/server/internal/store"
)

const (
	defaultSiteTitle        = "心悦AI"
	defaultSiteDescription  = ""
	maxSiteTitleRunes       = 60
	maxSiteDescriptionRunes = 300
)

type publicSiteConfig struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

func validSiteSetting(key, value string) bool {
	limit := maxSiteDescriptionRunes
	if key == "site_title" {
		limit = maxSiteTitleRunes
		if value == "" {
			return false
		}
	}
	if utf8.RuneCountInString(value) > limit {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return false
		}
	}
	return key != "site_title" || !strings.ContainsAny(value, "\r\n\t")
}

func siteSettingString(d Deps, key, fallback string) string {
	raw, err := store.GetSetting(d.DB, key)
	if err != nil || len(raw) == 0 {
		return fallback
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return fallback
	}
	value = strings.TrimSpace(value)
	if !validSiteSetting(key, value) {
		return fallback
	}
	return value
}

// siteConfigPublicHandler exposes only public branding text. The broader
// settings map contains credentials and must remain administrator-only.
func siteConfigPublicHandler(d Deps, w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, publicSiteConfig{
		Title:       siteSettingString(d, "site_title", defaultSiteTitle),
		Description: siteSettingString(d, "site_description", defaultSiteDescription),
	})
}
