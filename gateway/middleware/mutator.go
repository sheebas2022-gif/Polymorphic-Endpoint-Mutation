package middleware

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	mutation "polymorphic-api-gateway/gateway/crypto"
)

// Mutator validates routes before invoking the downstream handler.
func Mutator(seed []byte, window time.Duration, now func() time.Time, next http.Handler) http.Handler {
	if len(seed) < 32 || window < time.Second || window%time.Second != 0 {
		panic("seed must be at least 32 bytes; window must be whole positive seconds")
	}
	seed = append([]byte(nil), seed...)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		const prefix = "/api/v1/"
		// Reject encoded and ambiguous paths instead of letting downstream routers
		// reinterpret them. Query encoding is unaffected.
		if !strings.HasPrefix(r.URL.Path, prefix) || r.URL.EscapedPath() != r.URL.Path {
			http.NotFound(w, r)
			return
		}
		token, route, ok := strings.Cut(strings.TrimPrefix(r.URL.Path, prefix), "/")
		if !ok || len(token) != 8 || route == "" {
			http.NotFound(w, r)
			return
		}
		for _, segment := range strings.Split(route, "/") {
			if segment == "" || segment == "." || segment == ".." || strings.Contains(segment, "\\") {
				http.NotFound(w, r)
				return
			}
		}
		interval := now().Unix() / int64(window/time.Second)
		current := mutation.Token(seed, interval)
		previous := mutation.Token(seed, interval-1)
		valid := subtle.ConstantTimeCompare([]byte(token), []byte(current)) |
			subtle.ConstantTimeCompare([]byte(token), []byte(previous))
		if valid != 1 {
			http.NotFound(w, r)
			return
		}
		forward := r.Clone(r.Context())
		forward.URL.Path = prefix + route
		forward.URL.RawPath = ""
		next.ServeHTTP(w, forward)
	})
}
