package httpserver

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/store"
	"github.com/go-chi/chi/v5"
)

// handleExportChat handles GET /sessions/{id}/chats/{jid}/export?format=json|zip
// Returns either a JSON array of all messages, or a ZIP containing messages.json
// + a media/ subfolder with every downloaded file for the chat.
func (s *Server) handleExportChat(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	st := sess.Store()
	if st == nil {
		s.writeError(w, http.StatusServiceUnavailable, "store not ready")
		return
	}
	rawJID := chi.URLParam(r, "jid")
	jid, err := url.QueryUnescape(rawJID)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid jid")
		return
	}
	if !isSafeJID(jid) {
		s.writeError(w, http.StatusBadRequest, "unsafe jid")
		return
	}
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}

	// Pull every message for the chat in chronological order.
	msgs, err := fetchAllMessages(st, jid)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "fetch: "+err.Error())
		return
	}

	safeName := sanitizeFilename(jid)

	switch format {
	case "json":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.json"`, safeName))
		_ = json.NewEncoder(w).Encode(map[string]any{
			"chat_jid": jid,
			"count":    len(msgs),
			"messages": msgsToMap(msgs),
		})
	case "zip":
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.zip"`, safeName))
		zw := zip.NewWriter(w)
		defer zw.Close()
		// messages.json
		jsonFile, err := zw.Create("messages.json")
		if err == nil {
			_ = json.NewEncoder(jsonFile).Encode(msgsToMap(msgs))
		}
		// media/*
		mediaDir := filepath.Join(sess.StoreDir, "media", jid)
		if entries, _ := os.ReadDir(mediaDir); len(entries) > 0 {
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				src := filepath.Join(mediaDir, e.Name())
				f, err := os.Open(src)
				if err != nil {
					continue
				}
				zipFile, err := zw.Create("media/" + e.Name())
				if err == nil {
					_, _ = io.Copy(zipFile, f)
				}
				_ = f.Close()
			}
		}
	default:
		s.writeError(w, http.StatusBadRequest, "format must be json or zip")
	}
}

func fetchAllMessages(st *store.Store, jid string) ([]store.Message, error) {
	// Page through GetMessagesByChat in descending chunks; simpler to query
	// the DB directly here.
	rows, err := st.DB().Query(`
		SELECT msg_id, sender_jid, sender_name, ts, from_me,
		       COALESCE(text, ''), COALESCE(display_text, ''),
		       COALESCE(media_type, ''), COALESCE(media_caption, ''), COALESCE(filename, ''),
		       COALESCE(mime_type, ''), COALESCE(local_path, '')
		FROM messages WHERE chat_jid = ? ORDER BY ts ASC
	`, jid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.Message
	for rows.Next() {
		var m store.Message
		var fromMe int
		if err := rows.Scan(&m.MsgID, &m.SenderJID, &m.SenderName, &m.Ts, &fromMe,
			&m.Text, &m.DisplayText, &m.MediaType, &m.MediaCaption, &m.Filename,
			&m.MimeType, &m.LocalPath); err != nil {
			return nil, err
		}
		m.FromMe = fromMe != 0
		m.ChatJID = jid
		out = append(out, m)
	}
	return out, rows.Err()
}

func msgsToMap(msgs []store.Message) []map[string]any {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		row := map[string]any{
			"id":        m.MsgID,
			"sender":    m.SenderName,
			"senderJid": m.SenderJID,
			"timestamp": m.Ts,
			"fromMe":    m.FromMe,
		}
		if m.Text != "" {
			row["text"] = m.Text
		}
		if m.DisplayText != "" {
			row["displayText"] = m.DisplayText
		}
		if m.MediaType != "" {
			row["type"] = m.MediaType
			if m.MediaCaption != "" {
				row["caption"] = m.MediaCaption
			}
			if m.Filename != "" {
				row["filename"] = m.Filename
			}
			if m.MimeType != "" {
				row["mimeType"] = m.MimeType
			}
			if m.LocalPath != "" {
				row["mediaFile"] = "media/" + m.MsgID
			}
		}
		out = append(out, row)
	}
	return out
}

// isSafeJID rejects anything that could escape the per-chat media directory
// via filepath.Join. WhatsApp JIDs use digits, '@', '.', '-', and the servers
// s.whatsapp.net / g.us / lid / newsletter / broadcast / hosted.lid — all of
// those characters are covered by the regex below. Anything else (including
// '..', '/', '\\') is rejected.
func isSafeJID(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r == '@' || r == '.' || r == '-' || r == '_':
		default:
			return false
		}
	}
	return true
}

func sanitizeFilename(s string) string {
	out := strings.Map(func(r rune) rune {
		switch {
		case r == '@' || r == '.' || r == '-' || r == '_':
			return r
		case r >= 'a' && r <= 'z':
			return r
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		default:
			return '_'
		}
	}, s)
	if len(out) > 80 {
		out = out[:80]
	}
	return out
}
