package httpserver

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// handleReact handles POST /sessions/{id}/react
// Body: {"chatJid", "msgId", "senderJid", "fromMe", "emoji"}
func (s *Server) handleReact(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}

	var body struct {
		ChatJID   string `json:"chatJid"`
		MsgID     string `json:"msgId"`
		SenderJID string `json:"senderJid"`
		FromMe    bool   `json:"fromMe"`
		Emoji     string `json:"emoji"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.ChatJID == "" || body.MsgID == "" || body.SenderJID == "" {
		s.writeError(w, http.StatusBadRequest, "chatJid, msgId, and senderJid are required")
		return
	}

	if err := sess.React(r.Context(), body.ChatJID, body.MsgID, body.SenderJID, body.FromMe, body.Emoji); err != nil {
		s.writeError(w, http.StatusBadGateway, "react: "+err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleRevoke handles POST /sessions/{id}/delete
// Body: {"chatJid", "msgId", "senderJid", "fromMe"}
func (s *Server) handleRevoke(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}

	var body struct {
		ChatJID   string `json:"chatJid"`
		MsgID     string `json:"msgId"`
		SenderJID string `json:"senderJid"`
		FromMe    bool   `json:"fromMe"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.ChatJID == "" || body.MsgID == "" || body.SenderJID == "" {
		s.writeError(w, http.StatusBadRequest, "chatJid, msgId, and senderJid are required")
		return
	}

	if err := sess.Revoke(r.Context(), body.ChatJID, body.MsgID, body.SenderJID, body.FromMe); err != nil {
		s.writeError(w, http.StatusBadGateway, "revoke: "+err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleBackfill handles POST /sessions/{id}/backfill/{jid}?count=N
func (s *Server) handleBackfill(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}

	rawJID := chi.URLParam(r, "jid")
	chatJID, err := url.QueryUnescape(rawJID)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid jid encoding")
		return
	}

	count := 50
	if v := r.URL.Query().Get("count"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			count = n
		}
	}

	if err := sess.RequestHistoryBackfill(r.Context(), chatJID, count); err != nil {
		s.writeError(w, http.StatusBadGateway, "backfill: "+err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
