package httpserver

import (
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/avatars"
	"github.com/go-chi/chi/v5"
)

// handleChats handles GET /sessions/{id}/chats — returns all chats for a session.
func (s *Server) handleChats(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	st := sess.Store()
	if st == nil {
		s.writeError(w, http.StatusServiceUnavailable, "session store not ready")
		return
	}
	chats, err := st.GetChats()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "get chats: "+err.Error())
		return
	}
	out := make([]map[string]any, 0, len(chats))
	for _, c := range chats {
		row := map[string]any{
			"jid":          c.JID,
			"name":         c.Name,
			"kind":         c.Kind,
			"lastTs":       c.LastMessageTs,
			"lastMessage":  c.LastMessage,
			"lastSender":   c.LastSender,
			"msgCount":     c.MsgCount,
			"isGroup":      c.IsGroup,
			"hasAvatar":    avatars.Exists(sess.StoreDir, c.JID),
			"pinned":       c.Pinned,
			"manualUnread": c.ManualUnread,
			"identityKey":  c.IdentityKey,
		}
		if c.LID != "" {
			row["lid"] = c.LID
		}
		out = append(out, row)
	}
	s.writeJSON(w, http.StatusOK, out)
}

// handlePatchChat handles PATCH /sessions/{id}/chats/{jid} — toggles
// archived/pinned/manual_unread flags on a single chat.
func (s *Server) handlePatchChat(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	st := sess.Store()
	if st == nil {
		s.writeError(w, http.StatusServiceUnavailable, "session store not ready")
		return
	}
	rawJID := chi.URLParam(r, "jid")
	jid, err := url.QueryUnescape(rawJID)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid jid")
		return
	}
	var body struct {
		Archived     *bool `json:"archived,omitempty"`
		Pinned       *bool `json:"pinned,omitempty"`
		ManualUnread *bool `json:"manualUnread,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Archived != nil {
		if err := st.SetChatArchived(jid, *body.Archived); err != nil {
			s.writeError(w, http.StatusInternalServerError, "archive: "+err.Error())
			return
		}
	}
	if body.Pinned != nil {
		if err := st.SetChatPinned(jid, *body.Pinned); err != nil {
			s.writeError(w, http.StatusInternalServerError, "pin: "+err.Error())
			return
		}
	}
	if body.ManualUnread != nil {
		if err := st.SetChatManualUnread(jid, *body.ManualUnread); err != nil {
			s.writeError(w, http.StatusInternalServerError, "unread: "+err.Error())
			return
		}
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleDeleteChat handles DELETE /sessions/{id}/chats/{jid}?clearOnly=true
// — removes the chat (and all messages/reactions) locally. The whatsmeow
// session is NOT informed; this is a local housekeeping operation.
func (s *Server) handleDeleteChat(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	st := sess.Store()
	if st == nil {
		s.writeError(w, http.StatusServiceUnavailable, "session store not ready")
		return
	}
	rawJID := chi.URLParam(r, "jid")
	jid, err := url.QueryUnescape(rawJID)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid jid")
		return
	}
	clearOnly := r.URL.Query().Get("clearOnly") == "true"
	if clearOnly {
		if err := st.ClearChatMessages(jid); err != nil {
			s.writeError(w, http.StatusInternalServerError, "clear: "+err.Error())
			return
		}
	} else {
		if err := st.DeleteChat(jid); err != nil {
			s.writeError(w, http.StatusInternalServerError, "delete: "+err.Error())
			return
		}
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
