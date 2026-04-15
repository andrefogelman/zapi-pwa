package httpserver

import (
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// handleMessages handles GET /sessions/{id}/messages/{jid}?limit=N&before=TS
func (s *Server) handleMessages(w http.ResponseWriter, r *http.Request) {
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
		s.writeError(w, http.StatusBadRequest, "invalid jid encoding")
		return
	}

	q := r.URL.Query()
	limit := 50
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	var before int64
	if v := q.Get("before"); v != "" {
		before, _ = strconv.ParseInt(v, 10, 64)
	}
	var after int64
	if v := q.Get("after"); v != "" {
		after, _ = strconv.ParseInt(v, 10, 64)
	}

	msgs, err := st.GetMessagesByChat(jid, limit, before, after)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "get messages: "+err.Error())
		return
	}

	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		var mediaURL any
		if m.MediaType != "" {
			mediaURL = "media/" + url.PathEscape(m.ChatJID) + "/" + url.PathEscape(m.MsgID)
		}
		out = append(out, map[string]any{
			"id":           m.MsgID,
			"chatJid":      m.ChatJID,
			"chatName":     m.ChatName,
			"senderJid":    m.SenderJID,
			"senderName":   m.SenderName,
			"timestamp":    m.Ts,
			"fromMe":       m.FromMe,
			"text":         m.Text,
			"type":         m.MediaType,
			"mediaCaption": m.MediaCaption,
			"mediaUrl":     mediaURL,
			"filename":     m.Filename,
			"mimeType":     m.MimeType,
			"downloaded":   m.DownloadedAt > 0,
		})
	}
	s.writeJSON(w, http.StatusOK, out)
}

// handleSearch handles GET /sessions/{id}/search?q=TERM&limit=N
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
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

	q := r.URL.Query()
	term := q.Get("q")
	if term == "" {
		s.writeError(w, http.StatusBadRequest, "q is required")
		return
	}
	limit := 50
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}

	msgs, err := st.SearchMessages(term, limit)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "search: "+err.Error())
		return
	}

	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, map[string]any{
			"id":         m.MsgID,
			"chatJid":    m.ChatJID,
			"text":       m.Text,
			"type":       m.MediaType,
			"timestamp":  m.Ts,
			"fromMe":     m.FromMe,
			"senderName": m.SenderName,
		})
	}
	s.writeJSON(w, http.StatusOK, out)
}
