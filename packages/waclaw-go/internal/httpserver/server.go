// Package httpserver wires the chi router, middleware stack, and HTTP handlers
// for the waclaw-go daemon. Phases 7/8/9 add more route groups here.
package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/events"
	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/session"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
)

// startTime records when the process started, used for uptime_seconds in /health.
var startTime = time.Now()

// corsMiddleware enforces an explicit Origin allowlist. Browser XHRs from any
// other origin are blocked at the browser (CORS) layer; direct clients still
// authenticate with X-API-Key in authMiddleware.
//
// Origins come from the CORS_ALLOWED_ORIGINS env var (comma-separated). Empty
// means "no browser origin allowed" — server-to-server calls with X-API-Key
// are unaffected.
func corsMiddleware() func(http.Handler) http.Handler {
	raw := os.Getenv("CORS_ALLOWED_ORIGINS")
	var allowed []string
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			allowed = append(allowed, o)
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				for _, a := range allowed {
					if a == origin || a == "*" {
						w.Header().Set("Access-Control-Allow-Origin", origin)
						w.Header().Set("Vary", "Origin")
						w.Header().Set("Access-Control-Allow-Credentials", "true")
						w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
						w.Header().Set("Access-Control-Allow-Headers", "Authorization, X-API-Key, Content-Type")
						break
					}
				}
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Deps groups the external dependencies the HTTP layer needs.
type Deps struct {
	Manager *session.Manager
	Bus     *events.Bus
	Log     zerolog.Logger
	APIKey  string
}

// Server wraps net/http.Server together with the chi router and deps.
type Server struct {
	http http.Server
	mux  *chi.Mux
	deps Deps
}

// New builds a Server with the full middleware stack and mounts all routes.
func New(addr string, deps Deps) *Server {
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(RequestLogger(deps.Log))
	r.Use(corsMiddleware())

	s := &Server{
		mux:  r,
		deps: deps,
	}
	s.http = http.Server{
		Addr:    addr,
		Handler: r,
	}

	s.mountRoutes()
	return s
}

// mountRoutes registers all HTTP routes on the chi mux.
func (s *Server) mountRoutes() {
	// Public routes (no auth required)
	s.mux.Get("/health", s.handleHealth)

	// /events has its own auth (header OR query param) for EventSource
	// browser clients; mount it OUTSIDE the protected group.
	s.mux.Get("/events", s.handleEventsSSE)

	// Protected routes (X-API-Key required)
	s.mux.Group(func(r chi.Router) {
		r.Use(s.authMiddleware)
		r.Post("/sessions", s.handleCreateSession)
		r.Get("/sessions", s.handleListSessions)
		r.Route("/sessions/{id}", func(r chi.Router) {
			r.Delete("/", s.handleDeleteSession)
			r.Get("/status", s.handleSessionStatus)
			r.Get("/sync-status", s.handleSyncStatus)
			r.Post("/auth", s.handleAuth)
			r.Get("/qr", s.handleQR)
			r.Get("/chats", s.handleChats)
			r.Patch("/chats/{jid}", s.handlePatchChat)
			r.Delete("/chats/{jid}", s.handleDeleteChat)
			r.Get("/groups", s.handleListGroups)
			r.Get("/contacts/search", s.handleSearchContacts)
			r.Get("/contacts/{jid}", s.handleContactInfo)
			r.Post("/block/{jid}", s.handleBlock)
			r.Get("/blocked", s.handleListBlocked)
			r.Post("/mute/{jid}", s.handleMute)
			r.Get("/chats/{jid}/export", s.handleExportChat)
			r.Get("/messages/{jid}", s.handleMessages)
			r.Get("/search", s.handleSearch)
			// Phase 8: send, actions, media
			r.Post("/send", s.handleSendText)
			r.Post("/send-file", s.handleSendFile)
			r.Post("/react", s.handleReact)
			r.Post("/delete", s.handleRevoke)
			r.Post("/backfill/{jid}", s.handleBackfill)
			r.Get("/media/{jid}/{msgId}", s.handleMedia)
			// Phase 10: avatar cache
			r.Get("/avatar/{jid}", s.handleAvatar)
			r.Post("/avatars/refresh", s.handleAvatarRefresh)
		})
	})
}

// Run starts the HTTP server and blocks until ctx is cancelled or the server
// fails. On ctx cancellation it performs a graceful shutdown (5 s timeout).
func (s *Server) Run(ctx context.Context) error {
	errCh := make(chan error, 1)

	go func() {
		s.deps.Log.Info().Str("addr", s.http.Addr).Msg("http server listening")
		if err := s.http.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		s.deps.Log.Info().Msg("http server shutting down")
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return s.http.Shutdown(shutCtx)
	}
}

// handleHealth returns the server liveness payload.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	sessions := s.deps.Manager.List()
	s.writeJSON(w, http.StatusOK, map[string]any{
		"ok":              true,
		"activeSessions":  len(sessions),
		"uptime_seconds":  int(time.Since(startTime).Seconds()),
		"subscribers_sse": s.deps.Bus.SubscriberCount(),
	})
}

// handleListSessions returns all sessions with their id and state.
func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	sessions := s.deps.Manager.List()
	out := make([]map[string]any, 0, len(sessions))
	for _, sess := range sessions {
		out = append(out, map[string]any{
			"id":    sess.ID,
			"state": sess.State(),
		})
	}
	s.writeJSON(w, http.StatusOK, out)
}

// writeJSON encodes body as JSON and writes the response.
func (s *Server) writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		s.deps.Log.Error().Err(err).Msg("writeJSON encode error")
	}
}

// writeError writes a JSON error response.
func (s *Server) writeError(w http.ResponseWriter, status int, msg string) {
	s.writeJSON(w, status, map[string]string{"error": msg})
}

// RequestLogger returns a middleware that logs method, path, status, bytes, and duration.
func RequestLogger(log zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			log.Info().
				Str("method", r.Method).
				Str("path", r.URL.Path).
				Int("status", ww.Status()).
				Int("bytes", ww.BytesWritten()).
				Dur("duration", time.Since(start)).
				Msg("request")
		})
	}
}

// var _ silences the fmt import so Phase 7 handlers can use fmt without re-adding it.
var _ = fmt.Sprintf
