package httpserver

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

// Group names have a 25-character hard limit on WhatsApp. Longer names trigger
// 406 from the server; we truncate defensively.
const groupNameMaxLen = 25

// handleCreateGroup handles POST /sessions/{id}/groups/create
//
//	body: { "name": "...", "participants": ["5511...@s.whatsapp.net", ...] }
//	out : { "jid": "1203...@g.us" }
//
// Used by the task manager to spin up a per-task temporary group. Caller must
// ensure every participant number is already a known contact of the session
// owner (WhatsApp forbids adding strangers to groups).
func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
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
	var body struct {
		Name         string   `json:"name"`
		Participants []string `json:"participants"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		s.writeError(w, http.StatusBadRequest, "name required")
		return
	}
	if len(name) > groupNameMaxLen {
		name = name[:groupNameMaxLen]
	}
	if len(body.Participants) == 0 {
		s.writeError(w, http.StatusBadRequest, "at least one participant required")
		return
	}
	jids := make([]types.JID, 0, len(body.Participants))
	for _, p := range body.Participants {
		j, err := types.ParseJID(p)
		if err != nil {
			s.writeError(w, http.StatusBadRequest, "invalid participant jid: "+p)
			return
		}
		jids = append(jids, j)
	}
	info, err := client.CreateGroup(r.Context(), whatsmeow.ReqCreateGroup{
		Name:         name,
		Participants: jids,
	})
	if err != nil {
		s.writeError(w, http.StatusBadGateway, "CreateGroup: "+err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{
		"jid":          info.JID.String(),
		"name":         info.Name,
		"participants": len(info.Participants),
	})
}

// handleUpdateGroupParticipants handles POST /sessions/{id}/groups/{jid}/participants
//
//	body: { "add": ["..."], "remove": ["..."] }
func (s *Server) handleUpdateGroupParticipants(w http.ResponseWriter, r *http.Request) {
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
	rawJID := chi.URLParam(r, "jid")
	groupJIDStr, err := url.QueryUnescape(rawJID)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid group jid")
		return
	}
	if !isSafeJID(groupJIDStr) {
		s.writeError(w, http.StatusBadRequest, "unsafe jid")
		return
	}
	groupJID, err := types.ParseJID(groupJIDStr)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "parse jid: "+err.Error())
		return
	}
	var body struct {
		Add    []string `json:"add"`
		Remove []string `json:"remove"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	parse := func(raw []string) ([]types.JID, error) {
		out := make([]types.JID, 0, len(raw))
		for _, p := range raw {
			j, err := types.ParseJID(p)
			if err != nil {
				return nil, err
			}
			out = append(out, j)
		}
		return out, nil
	}
	result := map[string]any{}
	if len(body.Add) > 0 {
		jids, err := parse(body.Add)
		if err != nil {
			s.writeError(w, http.StatusBadRequest, "invalid add jid: "+err.Error())
			return
		}
		res, err := client.UpdateGroupParticipants(r.Context(), groupJID, jids, whatsmeow.ParticipantChangeAdd)
		if err != nil {
			s.writeError(w, http.StatusBadGateway, "add: "+err.Error())
			return
		}
		result["added"] = len(res)
	}
	if len(body.Remove) > 0 {
		jids, err := parse(body.Remove)
		if err != nil {
			s.writeError(w, http.StatusBadRequest, "invalid remove jid: "+err.Error())
			return
		}
		res, err := client.UpdateGroupParticipants(r.Context(), groupJID, jids, whatsmeow.ParticipantChangeRemove)
		if err != nil {
			s.writeError(w, http.StatusBadGateway, "remove: "+err.Error())
			return
		}
		result["removed"] = len(res)
	}
	if len(result) == 0 {
		s.writeError(w, http.StatusBadRequest, "nothing to do")
		return
	}
	result["ok"] = true
	s.writeJSON(w, http.StatusOK, result)
}

// handleSetGroupSubject handles POST /sessions/{id}/groups/{jid}/subject
// body { "name": "..." } — renames the group. Used when archiving a task so
// the group name gets a "[ARQUIVADO]" prefix.
func (s *Server) handleSetGroupSubject(w http.ResponseWriter, r *http.Request) {
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
	rawJID := chi.URLParam(r, "jid")
	groupJIDStr, err := url.QueryUnescape(rawJID)
	if err != nil || !isSafeJID(groupJIDStr) {
		s.writeError(w, http.StatusBadRequest, "invalid group jid")
		return
	}
	groupJID, err := types.ParseJID(groupJIDStr)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "parse jid: "+err.Error())
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		s.writeError(w, http.StatusBadRequest, "name required")
		return
	}
	name := body.Name
	if len(name) > groupNameMaxLen {
		name = name[:groupNameMaxLen]
	}
	if err := client.SetGroupName(r.Context(), groupJID, name); err != nil {
		s.writeError(w, http.StatusBadGateway, "SetGroupName: "+err.Error())
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": name})
}
