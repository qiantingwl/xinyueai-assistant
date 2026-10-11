package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestCanvasCRUDIsOwnerScoped(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "canvases.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	exec(t, db, `INSERT INTO users(id,email,password_hash,role) VALUES('u1','u1@example.test','h','user'),('u2','u2@example.test','h','user')`)

	ctx := context.Background()
	canvas, err := CreateCanvas(ctx, db, "u1", "Ideas")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if canvas.Data != defaultCanvasData || canvas.Zoom != 1 {
		t.Fatalf("defaults = %+v", canvas)
	}
	if _, err := GetCanvas(ctx, db, canvas.ID, "u2"); err != ErrNotFound {
		t.Fatalf("foreign get error = %v, want ErrNotFound", err)
	}

	data := `{"nodes":[{"id":"n1"}],"edges":[]}`
	updated, err := UpdateCanvas(ctx, db, canvas.ID, "u1", CanvasPatch{Data: &data})
	if err != nil || updated.Data != data {
		t.Fatalf("update = %+v, err=%v", updated, err)
	}
	rows, err := ListCanvases(ctx, db, "u1")
	if err != nil || len(rows) != 1 || rows[0].Data != data {
		t.Fatalf("list = %+v, err=%v", rows, err)
	}
	if err := DeleteCanvas(ctx, db, canvas.ID, "u2"); err != ErrNotFound {
		t.Fatalf("foreign delete error = %v, want ErrNotFound", err)
	}
	if err := DeleteCanvas(ctx, db, canvas.ID, "u1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
}
