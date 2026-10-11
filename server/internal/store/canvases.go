package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

const defaultCanvasData = `{"nodes":[],"edges":[]}`

func scanCanvas(scanner interface{ Scan(...any) error }) (*Canvas, error) {
	var c Canvas
	if err := scanner.Scan(
		&c.ID, &c.UserID, &c.Name, &c.Data, &c.ThumbnailURL,
		&c.ViewportX, &c.ViewportY, &c.Zoom, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &c, nil
}

func ListCanvases(ctx context.Context, db *sql.DB, userID string) ([]Canvas, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, user_id, name, data, thumbnail_url, viewport_x, viewport_y, zoom, created_at, updated_at
		FROM canvases WHERE user_id=? ORDER BY updated_at DESC, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Canvas, 0)
	for rows.Next() {
		c, err := scanCanvas(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func GetCanvas(ctx context.Context, db *sql.DB, id, userID string) (*Canvas, error) {
	c, err := scanCanvas(db.QueryRowContext(ctx, `
		SELECT id, user_id, name, data, thumbnail_url, viewport_x, viewport_y, zoom, created_at, updated_at
		FROM canvases WHERE id=? AND user_id=?`, id, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

func CreateCanvas(ctx context.Context, db *sql.DB, userID, name string) (*Canvas, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Untitled canvas"
	}
	now := time.Now().Unix()
	c := Canvas{
		ID: GenID("canvas"), UserID: userID, Name: name, Data: defaultCanvasData,
		Zoom: 1, CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.ExecContext(ctx, `
		INSERT INTO canvases(id,user_id,name,data,thumbnail_url,viewport_x,viewport_y,zoom,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?)`, c.ID, c.UserID, c.Name, c.Data, c.ThumbnailURL, c.ViewportX, c.ViewportY, c.Zoom, c.CreatedAt, c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func UpdateCanvas(ctx context.Context, db *sql.DB, id, userID string, patch CanvasPatch) (*Canvas, error) {
	current, err := GetCanvas(ctx, db, id, userID)
	if err != nil {
		return nil, err
	}
	if patch.Name != nil {
		current.Name = strings.TrimSpace(*patch.Name)
		if current.Name == "" {
			return nil, errors.New("name required")
		}
	}
	if patch.Data != nil {
		current.Data = *patch.Data
	}
	if patch.ThumbnailURL != nil {
		current.ThumbnailURL = strings.TrimSpace(*patch.ThumbnailURL)
	}
	if patch.ViewportX != nil {
		current.ViewportX = *patch.ViewportX
	}
	if patch.ViewportY != nil {
		current.ViewportY = *patch.ViewportY
	}
	if patch.Zoom != nil {
		current.Zoom = *patch.Zoom
	}
	current.UpdatedAt = time.Now().Unix()
	_, err = db.ExecContext(ctx, `
		UPDATE canvases SET name=?,data=?,thumbnail_url=?,viewport_x=?,viewport_y=?,zoom=?,updated_at=?
		WHERE id=? AND user_id=?`, current.Name, current.Data, current.ThumbnailURL, current.ViewportX, current.ViewportY, current.Zoom, current.UpdatedAt, id, userID)
	if err != nil {
		return nil, err
	}
	return current, nil
}

func DeleteCanvas(ctx context.Context, db *sql.DB, id, userID string) error {
	result, err := db.ExecContext(ctx, `DELETE FROM canvases WHERE id=? AND user_id=?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
