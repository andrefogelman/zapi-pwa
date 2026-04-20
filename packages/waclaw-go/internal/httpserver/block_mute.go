package httpserver

import (
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// handleBlock handles POST /sessions/{id}/block/{jid} with body { block: bool }.
// Propagates to WhatsApp via client.UpdateBlocklist (synced across user's
// devices), then mirrors locally in contacts.blocked.
func (s *Server) handleBlock(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	st := sess.Store()
	client := sess.Client()
	if st == nil || client == nil {
		s.writeError(w, http.StatusServiceUnavailable, "session not ready")
		return
	}
	rawJID := chi.URLParam(r, "jid")
	jidStr, err := url.QueryUnescape(rawJID)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid jid")
		return
	}
	parsed, err := types.ParseJID(jidStr)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "parse jid: "+err.Error())
		return
	}
	var body struct {
		Block bool `json:"block"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	action := events.BlocklistChangeActionBlock
	if !body.Block {
		action = events.BlocklistChangeActionUnblock
	}
	if _, err := client.UpdateBlocklist(r.Context(), parsed, action); err != nil {
		s.writeError(w, http.StatusBadGateway, "UpdateBlocklist: "+err.Error())
		return
	}
	if err := st.SetContactBlocked(jidStr, body.Block); err != nil {
		s.writeError(w, http.StatusInternalServerError, "persist: "+err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "blocked": body.Block})
}

// handleListBlocked handles GET /sessions/{id}/blocked — returns the local
// snapshot of blocked JIDs.
func (s *Server) handleListBlocked(w http.ResponseWriter, r *http.Request) {
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
	jids, err := st.GetBlockedJIDs()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "list: "+err.Error())
		return
	}
	if jids == nil {
		jids = []string{}
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"jids": jids})
}

// handleMute handles POST /sessions/{id}/mute/{jid} with body:
//
//	{ "mute": true, "until": 0 }             // forever
//	{ "mute": true, "until": 1734567890 }    // until unix ts (seconds)
//	{ "mute": false }                         // unmute
//
// Propagates via client.SendAppState (BuildMute) so other devices see it.
func (s *Server) handleMute(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	st := sess.Store()
	client := sess.Client()
	if st == nil || client == nil {
		s.writeError(w, http.StatusServiceUnavailable, "session not ready")
		return
	}
	rawJID := chi.URLParam(r, "jid")
	jidStr, err := url.QueryUnescape(rawJID)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid jid")
		return
	}
	parsed, err := types.ParseJID(jidStr)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "parse jid: "+err.Error())
		return
	}
	var body struct {
		Mute  bool  `json:"mute"`
		Until int64 `json:"until"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	var duration time.Duration
	switch {
	case !body.Mute:
		duration = 0
	case body.Until == 0:
		// Forever.
		duration = 0
	default:
		until := time.Unix(body.Until, 0)
		duration = time.Until(until)
		if duration < 0 {
			duration = 0
		}
	}
	patch := appstate.BuildMute(parsed, body.Mute, duration)
	if err := client.SendAppState(r.Context(), patch); err != nil {
		s.writeError(w, http.StatusBadGateway, "SendAppState: "+err.Error())
		return
	}
	storeUntil := int64(0)
	if body.Mute {
		if body.Until == 0 {
			storeUntil = math.MaxInt64
		} else {
			storeUntil = body.Until
		}
	}
	if err := st.SetChatMutedUntil(jidStr, storeUntil); err != nil {
		s.writeError(w, http.StatusInternalServerError, "persist: "+err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "mutedUntil": storeUntil})
}
