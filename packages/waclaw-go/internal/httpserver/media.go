package httpserver

import (
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

// handleMedia handles GET /sessions/{id}/media/{jid}/{msgId}
// Streams the locally cached media file for the given message.
// Returns 425 if the file has not been downloaded yet,
// 404 if the message or file is not found.
func (s *Server) handleMedia(w http.ResponseWriter, r *http.Request) {
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
	rawMsgID := chi.URLParam(r, "msgId")

	chatJID, err := url.QueryUnescape(rawJID)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid jid encoding")
		return
	}
	if !isSafeJID(chatJID) {
		s.writeError(w, http.StatusBadRequest, "unsafe jid")
		return
	}
	msgID, err := url.QueryUnescape(rawMsgID)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid msgId encoding")
		return
	}
	// msgIDs in whatsmeow are uppercase hex-like identifiers; restrict hard.
	if !isSafeMsgID(msgID) {
		s.writeError(w, http.StatusBadRequest, "unsafe msgId")
		return
	}

	m, err := st.GetMessageByID(chatJID, msgID)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "store: "+err.Error())
		return
	}
	if m == nil {
		s.writeError(w, http.StatusNotFound, "message not found")
		return
	}

	if m.LocalPath == "" {
		// File not yet downloaded — tell the client to retry later.
		s.writeError(w, http.StatusTooEarly, "media not yet downloaded")
		return
	}

	if _, err := os.Stat(m.LocalPath); os.IsNotExist(err) {
		s.writeError(w, http.StatusNotFound, "media file missing on disk")
		return
	}

	// Determine content type: use stored mime (strip params) or fall back to extension.
	ct := m.MimeType
	if idx := strings.Index(ct, ";"); idx != -1 {
		ct = strings.TrimSpace(ct[:idx])
	}
	if ct == "" {
		ct = guessMime(m.LocalPath)
	}
	w.Header().Set("Content-Type", ct)
	// Per-user media. No shared cache (CDN or proxy) should hold it.
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeFile(w, r, m.LocalPath)
}

// isSafeMsgID rejects anything that could escape a chat's media folder via
// filepath.Join. whatsmeow msg ids are hex-like strings.
func isSafeMsgID(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r == '-' || r == '_':
		default:
			return false
		}
	}
	return true
}

// guessMime returns a MIME type based on the file extension.
func guessMime(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".oga", ".ogg":
		return "audio/ogg"
	case ".mp3":
		return "audio/mpeg"
	case ".m4a":
		return "audio/mp4"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".pdf":
		return "application/pdf"
	default:
		return "application/octet-stream"
	}
}
