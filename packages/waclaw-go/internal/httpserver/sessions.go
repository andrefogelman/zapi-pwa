package httpserver

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// handleCreateSession handles POST /sessions — creates a new session and returns its ID.
func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	sess, err := s.deps.Manager.Create(r.Context())
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "create session: "+err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"id": sess.ID})
}

// handleDeleteSession handles DELETE /sessions/{id} — deletes a session or 404 if not found.
func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.deps.Manager.Delete(r.Context(), id); err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleSessionStatus handles GET /sessions/{id}/status — returns id, state, connected, storePath.
func (s *Server) handleSessionStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	state := sess.State()
	s.writeJSON(w, http.StatusOK, map[string]any{
		"id":        sess.ID,
		"state":     state,
		"connected": state == "connected",
		"storePath": sess.StorePath(),
	})
}

// handleSyncStatus handles GET /sessions/{id}/sync-status — returns store
// counts + freshness indicators. Consumers (PWA, monitoring) use this to
// detect stale stores that require a backfill.
func (s *Server) handleSyncStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	st := sess.Store()
	if st == nil {
		s.writeError(w, http.StatusServiceUnavailable, "store not initialised")
		return
	}
	stats, err := st.GetSyncStats()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	state := sess.State()
	s.writeJSON(w, http.StatusOK, map[string]any{
		"id":                 sess.ID,
		"state":              state,
		"connected":          state == "connected",
		"message_count":      stats.MessageCount,
		"chat_count":         stats.ChatCount,
		"oldest_message_ts":  stats.OldestMsgTs,
		"newest_message_ts":  stats.NewestMsgTs,
	})
}
