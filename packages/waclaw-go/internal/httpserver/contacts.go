package httpserver

import (
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
	"go.mau.fi/whatsmeow/types"
)

// handleSearchContacts handles GET /sessions/{id}/contacts/search?q=term&limit=N
// Returns contacts from the address book whose name/push_name/business_name
// matches. Used by the sidebar search to surface "Other contacts" — people the
// user has in their contacts but no active chat with.
func (s *Server) handleSearchContacts(w http.ResponseWriter, r *http.Request) {
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
	q := r.URL.Query().Get("q")
	if q == "" {
		s.writeJSON(w, http.StatusOK, []any{})
		return
	}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	cs, err := st.SearchContacts(q, limit)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "search contacts: "+err.Error())
		return
	}
	out := make([]map[string]any, 0, len(cs))
	for _, c := range cs {
		// Resolve a display name: full_name > business_name > push_name > phone.
		name := c.FullName
		if name == "" {
			name = c.BusinessName
		}
		if name == "" {
			name = c.PushName
		}
		row := map[string]any{
			"jid":   c.JID,
			"phone": c.Phone,
			"name":  name,
		}
		if c.LID != "" {
			row["lid"] = c.LID
		}
		out = append(out, row)
	}
	s.writeJSON(w, http.StatusOK, out)
}

// handleContactInfo handles GET /sessions/{id}/contacts/{jid} — returns the
// cached contact row plus a live GetUserInfo call to refresh status/picture.
func (s *Server) handleContactInfo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	st := sess.Store()
	client := sess.Client()
	if st == nil {
		s.writeError(w, http.StatusServiceUnavailable, "store not ready")
		return
	}
	rawJID := chi.URLParam(r, "jid")
	jidStr, err := url.QueryUnescape(rawJID)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid jid")
		return
	}
	c, _ := st.GetContact(jidStr)
	// Count messages + first/last.
	var msgCount int64
	var firstTs, lastTs int64
	_ = st.DB().QueryRow(`SELECT COUNT(*), COALESCE(MIN(ts),0), COALESCE(MAX(ts),0) FROM messages WHERE chat_jid = ? OR sender_jid = ?`, jidStr, jidStr).
		Scan(&msgCount, &firstTs, &lastTs)

	out := map[string]any{
		"jid":          jidStr,
		"messageCount": msgCount,
		"firstMessage": firstTs,
		"lastMessage":  lastTs,
	}
	if c != nil {
		if c.LID != "" {
			out["lid"] = c.LID
		}
		out["pushName"] = c.PushName
		out["fullName"] = c.FullName
		out["businessName"] = c.BusinessName
		out["phone"] = c.Phone
	}
	// Live refresh from whatsmeow — best-effort.
	if client != nil {
		if parsed, err := types.ParseJID(jidStr); err == nil {
			if infoMap, err := client.GetUserInfo(r.Context(), []types.JID{parsed}); err == nil {
				if info, ok := infoMap[parsed]; ok {
					out["status"] = info.Status
					if info.VerifiedName != nil && info.VerifiedName.Details != nil {
						if vn := info.VerifiedName.Details.GetVerifiedName(); vn != "" {
							out["verifiedName"] = vn
						}
					}
					if !info.LID.IsEmpty() {
						out["liveLid"] = info.LID.String()
					}
				}
			}
		}
	}
	s.writeJSON(w, http.StatusOK, out)
}
