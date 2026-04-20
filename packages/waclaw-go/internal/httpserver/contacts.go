package httpserver

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
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
