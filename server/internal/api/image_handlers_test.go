package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestListImageStylesPublicAllowsGuests(t *testing.T) {
	db := openMigrated(t, filepath.Join(t.TempDir(), "image-styles.db"))
	t.Cleanup(func() { _ = db.Close() })
	mustExec(t, db, `INSERT INTO image_styles(id,name,example_image_url,hidden_prompt,enabled,sort_order) VALUES
		('style-enabled','Watercolor','https://example.test/watercolor.png','secret watercolor prompt',1,0),
		('style-disabled','Hidden','https://example.test/hidden.png','secret hidden prompt',0,1)`)

	rec := httptest.NewRecorder()
	listImageStylesPublic(Deps{DB: db}, rec, httptest.NewRequest(http.MethodGet, "/api/image/styles", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got) != 1 || got[0]["id"] != "style-enabled" {
		t.Fatalf("styles = %#v, want only enabled style", got)
	}
	if _, leaked := got[0]["hidden_prompt"]; leaked {
		t.Fatal("response leaked hidden_prompt")
	}
}
