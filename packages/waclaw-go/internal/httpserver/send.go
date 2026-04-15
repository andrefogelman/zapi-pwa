package httpserver

import (
	"encoding/base64"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// handleSendText handles POST /sessions/{id}/send
// Body: {"to": "...", "message": "..."}
// Response: {"ok": true, "id": "..."}
func (s *Server) handleSendText(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}

	var body struct {
		To           string `json:"to"`
		Message      string `json:"message"`
		QuotedMsgID  string `json:"quotedMsgId,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.To == "" || body.Message == "" {
		s.writeError(w, http.StatusBadRequest, "to and message are required")
		return
	}

	msgID, err := sess.SendText(r.Context(), body.To, body.Message, body.QuotedMsgID)
	if err != nil {
		s.writeError(w, http.StatusBadGateway, "send: "+err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": msgID})
}

// handleSendFile handles POST /sessions/{id}/send-file
// Body: {"to", "filename", "mimeType", "caption", "dataBase64"}
// Response: {"ok": true, "id": "..."}
func (s *Server) handleSendFile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}

	var body struct {
		To         string `json:"to"`
		Filename   string `json:"filename"`
		MimeType   string `json:"mimeType"`
		Caption    string `json:"caption"`
		DataBase64 string `json:"dataBase64"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.To == "" || body.DataBase64 == "" {
		s.writeError(w, http.StatusBadRequest, "to and dataBase64 are required")
		return
	}

	data, err := base64.StdEncoding.DecodeString(body.DataBase64)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "dataBase64 is not valid base64: "+err.Error())
		return
	}

	msgID, err := sess.SendFile(r.Context(), body.To, data, body.Filename, body.MimeType, body.Caption)
	if err != nil {
		s.writeError(w, http.StatusBadGateway, "send-file: "+err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": msgID})
}
