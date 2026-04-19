package httpserver

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// handleListGroups handles GET /sessions/{id}/groups — returns groups the
// connected WhatsApp account is a member of, fetched live from the server.
//
// Used by the PWA's "Buscar grupos do WhatsApp" flow to let the user pick
// which groups to authorize for audio transcription.
func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	client := sess.Client()
	if client == nil {
		s.writeError(w, http.StatusServiceUnavailable, "session not connected")
		return
	}
	infos, err := client.GetJoinedGroups(r.Context())
	if err != nil {
		s.writeError(w, http.StatusBadGateway, "GetJoinedGroups: "+err.Error())
		return
	}
	out := make([]map[string]any, 0, len(infos))
	for _, g := range infos {
		if g == nil {
			continue
		}
		out = append(out, map[string]any{
			"group_id": g.JID.String(),
			"subject":  g.Name,
		})
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"groups": out})
}
