package httpserver

import (
	"net/http"
	"sync"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/avatars"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// handleAvatar: GET /sessions/:id/avatar/:jid — streams the cached JPEG,
// returns 404 if the avatar has not been downloaded yet.
func (s *Server) handleAvatar(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	jid := chi.URLParam(r, "jid")

	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}

	// If avatar is not cached, try to download it on-demand.
	if !avatars.Exists(sess.StoreDir, jid) {
		data, err := sess.GetProfilePicture(r.Context(), jid)
		if err != nil {
			log.Debug().Err(err).Str("jid", jid).Msg("on-demand avatar download failed")
			s.writeError(w, http.StatusNotFound, "avatar not available")
			return
		}
		if data == nil {
			s.writeError(w, http.StatusNotFound, "no profile picture")
			return
		}
		if err := avatars.Save(sess.StoreDir, jid, data); err != nil {
			log.Error().Err(err).Str("jid", jid).Msg("save avatar failed")
			s.writeError(w, http.StatusInternalServerError, "save failed")
			return
		}
	}

	path := avatars.Path(sess.StoreDir, jid)
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, r, path)
}

// handleAvatarRefresh: POST /sessions/:id/avatars/refresh — downloads profile
// pictures for all chats that do not have a cached avatar yet.
func (s *Server) handleAvatarRefresh(w http.ResponseWriter, r *http.Request) {
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

	chats, err := st.GetChats()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "get chats: "+err.Error())
		return
	}

	results := make(map[string]string)
	var mu sync.Mutex
	var wg sync.WaitGroup

	// Limit concurrency to avoid WhatsApp rate limits.
	sem := make(chan struct{}, 5)

	for _, c := range chats {
		if avatars.Exists(sess.StoreDir, c.JID) {
			mu.Lock()
			results[c.JID] = "cached"
			mu.Unlock()
			continue
		}

		wg.Add(1)
		sem <- struct{}{} // acquire
		go func(jid string) {
			defer wg.Done()
			defer func() { <-sem }() // release

			data, err := sess.GetProfilePicture(r.Context(), jid)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				results[jid] = "error"
				log.Debug().Err(err).Str("jid", jid).Msg("refresh avatar failed")
				return
			}
			if data == nil {
				results[jid] = "no_picture"
				return
			}
			if err := avatars.Save(sess.StoreDir, jid, data); err != nil {
				results[jid] = "save_error"
				return
			}
			results[jid] = "downloaded"
		}(c.JID)
	}

	wg.Wait()

	downloaded := 0
	for _, v := range results {
		if v == "downloaded" {
			downloaded++
		}
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"total":      len(chats),
		"downloaded": downloaded,
		"results":    results,
	})
}
