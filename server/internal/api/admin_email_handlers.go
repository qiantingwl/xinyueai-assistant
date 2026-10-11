package api

import (
	"net/http"

	"aivory/server/internal/mail"
	"aivory/server/internal/store"
)

func sendTestEmailAdmin(d Deps, w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, errInvalidInput)
		return
	}
	recipient, err := store.NormalizeUserEmail(req.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, errInvalidEmail)
		return
	}
	tester, ok := d.Mailer.(mail.TestSender)
	if !ok {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": errEmailTestUnavailable.Error()})
		return
	}
	if err := tester.SendTest(recipient); err != nil {
		if d.Logger != nil {
			d.Logger.Printf("[mail] SMTP test to %s failed: %v", recipient, err)
		}
		// This is a stable machine code, not the SMTP error itself. The detailed
		// upstream failure is kept in the administrator log above.
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": errEmailTestFailed.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
