package api

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"

	"aivory/server/internal/store"
)

const maxCanvasSnapshotBytes = 4 << 20

func listCanvasesHandler(d Deps, w http.ResponseWriter, r *http.Request) {
	u := authUser(r)
	canvases, err := store.ListCanvases(r.Context(), d.DB, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, canvases)
}

func createCanvasHandler(d Deps, w http.ResponseWriter, r *http.Request) {
	u := authUser(r)
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errInvalidInput)
		return
	}
	canvas, err := store.CreateCanvas(r.Context(), d.DB, u.ID, body.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, canvas)
}

func getCanvasHandler(d Deps, w http.ResponseWriter, r *http.Request) {
	u := authUser(r)
	canvas, err := store.GetCanvas(r.Context(), d.DB, pathParam(r, "id"), u.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, errNotFound)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, canvas)
}

func updateCanvasHandler(d Deps, w http.ResponseWriter, r *http.Request) {
	u := authUser(r)
	var patch store.CanvasPatch
	if err := decodeJSON(r, &patch); err != nil {
		writeError(w, http.StatusBadRequest, errInvalidInput)
		return
	}
	if patch.Name != nil {
		name := strings.TrimSpace(*patch.Name)
		if name == "" || len(name) > 160 {
			writeError(w, http.StatusBadRequest, errInvalidInput)
			return
		}
		patch.Name = &name
	}
	if patch.Data != nil {
		if len(*patch.Data) > maxCanvasSnapshotBytes || !json.Valid([]byte(*patch.Data)) {
			writeError(w, http.StatusBadRequest, errInvalidInput)
			return
		}
	}
	if patch.ThumbnailURL != nil && len(*patch.ThumbnailURL) > 2000 {
		writeError(w, http.StatusBadRequest, errInvalidInput)
		return
	}
	if patch.Zoom != nil && (*patch.Zoom < 0.1 || *patch.Zoom > 4 || math.IsNaN(*patch.Zoom) || math.IsInf(*patch.Zoom, 0)) {
		writeError(w, http.StatusBadRequest, errInvalidInput)
		return
	}
	canvas, err := store.UpdateCanvas(r.Context(), d.DB, pathParam(r, "id"), u.ID, patch)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, errNotFound)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, canvas)
}

func deleteCanvasHandler(d Deps, w http.ResponseWriter, r *http.Request) {
	u := authUser(r)
	err := store.DeleteCanvas(r.Context(), d.DB, pathParam(r, "id"), u.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, errNotFound)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
