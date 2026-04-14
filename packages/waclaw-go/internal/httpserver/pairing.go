package httpserver

import (
	"net/http"
	"time"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/session"
	"github.com/go-chi/chi/v5"
)

// handleAuth handles POST /sessions/{id}/auth — kicks off Connect in a goroutine,
// then polls until either connected or a QR code is available (up to 20 s).
func (s *Server) handleAuth(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}

	// Run Connect in a goroutine — it may block briefly on network I/O.
	go func() {
		if err := sess.Connect(r.Context()); err != nil {
			s.deps.Log.Warn().Err(err).Str("session", id).Msg("connect error")
		}
	}()

	// Poll for either connected or QR ready (100 ms tick, 20 s deadline).
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()

	for {
		st := sess.State()
		if st == session.StateConnected {
			s.writeJSON(w, http.StatusOK, map[string]any{"state": "connected"})
			return
		}
		qr := sess.LastQR()
		if qr != "" {
			s.writeJSON(w, http.StatusOK, map[string]any{
				"qr":    qr,
				"state": "waiting_qr",
			})
			return
		}
		select {
		case <-r.Context().Done():
			s.writeError(w, http.StatusGatewayTimeout, "request cancelled")
			return
		case <-deadline.C:
			s.writeError(w, http.StatusGatewayTimeout, "timeout waiting for QR or connected state")
			return
		case <-tick.C:
		}
	}
}

// handleQR handles GET /sessions/{id}/qr — returns current state and QR if available.
func (s *Server) handleQR(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, err := s.deps.Manager.Get(id)
	if err != nil {
		s.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	resp := map[string]any{
		"state": string(sess.State()),
	}
	if qr := sess.LastQR(); qr != "" {
		resp["qr"] = qr
	}
	s.writeJSON(w, http.StatusOK, resp)
}
