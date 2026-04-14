package httpserver

import (
	"fmt"
	"net/http"
	"time"
)

// handleEventsSSE streams WhatsApp events as Server-Sent Events.
//
// Auth: reads X-API-Key header OR ?token= query param. EventSource browser
// clients cannot set custom headers, so the query-param fallback is required.
//
// SSE format: each event is emitted as "data: <json>\n\n".
// Heartbeat comments (": ping\n\n") are sent every 15 s to prevent idle
// proxy/load-balancer disconnections.
func (s *Server) handleEventsSSE(w http.ResponseWriter, r *http.Request) {
	// Inline auth: header OR query param.
	key := r.Header.Get("X-API-Key")
	if key == "" {
		key = r.URL.Query().Get("token")
	}
	if key != s.deps.APIKey {
		s.writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Assert Flusher before writing headers.
	flusher, ok := w.(http.Flusher)
	if !ok {
		s.writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// SSE headers.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	// Send initial comment to flush headers through proxies.
	fmt.Fprintf(w, ": subscribed\n\n")
	flusher.Flush()

	// Subscribe to the event bus.
	ch, unsub := s.deps.Bus.Subscribe(64)
	defer unsub()

	// Heartbeat ticker.
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case evt, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", evt.Raw)
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}
