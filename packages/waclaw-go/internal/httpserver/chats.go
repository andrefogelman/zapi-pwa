package httpserver

import (
	"net/http"

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
			"jid":         c.JID,
			"name":        c.Name,
			"kind":        c.Kind,
			"lastTs":      c.LastMessageTs,
			"lastMessage": c.LastMessage,
			"lastSender":  c.LastSender,
			"msgCount":    c.MsgCount,
			"isGroup":     c.IsGroup,
			"hasAvatar":   avatars.Exists(sess.StoreDir, c.JID),
		}
		if c.LID != "" {
			row["lid"] = c.LID
		}
		out = append(out, row)
	}
	s.writeJSON(w, http.StatusOK, out)
}
