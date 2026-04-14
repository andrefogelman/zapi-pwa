package httpserver

import "net/http"

const headerAPIKey = "X-API-Key"

// authMiddleware validates the X-API-Key header against the configured key.
// Returns 401 if the header is missing or does not match.
func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(headerAPIKey) != s.deps.APIKey {
			s.writeError(w, http.StatusUnauthorized, "Invalid API key")
			return
		}
		next.ServeHTTP(w, r)
	})
}
