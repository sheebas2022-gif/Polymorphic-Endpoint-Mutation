// Package demo provides an explicitly enabled, loopback-only teaching dashboard.
package demo

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	mutation "polymorphic-api-gateway/gateway/crypto"
)

//go:embed web/*
var assets embed.FS

type Event struct {
	ID                int64     `json:"id"`
	Time              time.Time `json:"time"`
	RequestID         string    `json:"requestId"`
	Method            string    `json:"method"`
	Incoming          string    `json:"incoming"`
	Forwarded         string    `json:"forwarded"`
	BackendAttempted  bool      `json:"backendAttempted"`
	BackendResponded  bool      `json:"backendResponded"`
	Status            int       `json:"status"`
	DurationMs        float64   `json:"durationMs"`
	Source            string    `json:"source"`
	PageID            string    `json:"pageId"`
	ResponseBody      string    `json:"responseBody"`
	ResponseTruncated bool      `json:"responseTruncated"`
}

type traceKey struct{}
type Store struct {
	BackendURL       string
	mu               sync.Mutex
	events           []Event
	total            int64
	forwarded        int64
	blocked          int64
	backendResponses int64
	started          time.Time
}

func New() *Store { return &Store{started: time.Now(), events: []Event{}} }

type recorder struct {
	http.ResponseWriter
	status    int
	body      []byte
	truncated bool
}

func (w *recorder) WriteHeader(code int) {
	if code < 200 {
		w.ResponseWriter.WriteHeader(code)
		return
	}
	if w.status == 0 {
		w.status = code
		w.ResponseWriter.WriteHeader(code)
	}
}
func (w *recorder) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(data)
	remaining := 8192 - len(w.body)
	if n > remaining {
		w.body = append(w.body, data[:remaining]...)
		w.truncated = true
	} else {
		w.body = append(w.body, data[:n]...)
	}
	return n, err
}
func (w *recorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Wrap records only API requests, never dashboard polling or static files.
func (s *Store) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		event := &Event{Time: start, RequestID: r.Header.Get("X-Demo-Request-ID"), Method: r.Method, Incoming: r.URL.RequestURI()}
		event.Source = r.Header.Get("X-Demo-Source")
		if event.Source != "client" && event.Source != "dashboard" {
			event.Source = "external"
		}
		event.PageID = r.Header.Get("X-Demo-Page-ID")
		if len(event.PageID) > 80 {
			event.PageID = ""
		}
		if len(event.RequestID) > 80 {
			event.RequestID = ""
		}
		if len(event.Incoming) > 2048 {
			event.Incoming = event.Incoming[:2048] + "…"
		}
		out := &recorder{ResponseWriter: w}
		next.ServeHTTP(out, r.WithContext(context.WithValue(r.Context(), traceKey{}, event)))
		event.Status = out.status
		event.ResponseBody = string(out.body)
		event.ResponseTruncated = out.truncated
		if event.Status == 0 {
			event.Status = 200
		}
		event.DurationMs = float64(time.Since(start).Microseconds()) / 1000
		s.mu.Lock()
		defer s.mu.Unlock()
		s.total++
		event.ID = s.total
		if event.BackendAttempted {
			s.forwarded++
		} else {
			s.blocked++
		}
		if event.BackendResponded {
			s.backendResponses++
		}
		s.events = append([]Event{*event}, s.events...)
		if len(s.events) > 100 {
			s.events = s.events[:100]
		}
	})
}

func (s *Store) Forward(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if event, ok := r.Context().Value(traceKey{}).(*Event); ok {
			event.BackendAttempted = true
			event.Forwarded = r.URL.RequestURI()
		}
		next.ServeHTTP(w, r)
	})
}

func BackendResponse(response *http.Response) error {
	if event, ok := response.Request.Context().Value(traceKey{}).(*Event); ok {
		event.BackendResponded = true
	}
	return nil
}

func (s *Store) Handler(seed []byte, seconds int, api http.Handler) http.Handler {
	web, _ := fs.Sub(assets, "web")
	files := http.FileServer(http.FS(web))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		// Restrict Host too, so a DNS-rebinding site cannot access demo tokens.
		if !isLoopbackHost(r.Host) {
			http.Error(w, "Demo is available on the local loopback host only", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
			http.Error(w, "Cross-origin demo requests are disabled", http.StatusForbidden)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed", 405)
			return
		}
		if r.URL.Path == "/demo/client-config" {
			w.Header().Set("Content-Type", "application/json")
			// This explicit local demo bootstraps the browser HMAC generator.
			// A browser seed is extractable: this is not authentication.
			json.NewEncoder(w).Encode(map[string]any{"seed": string(seed), "serverTime": time.Now().UnixMilli(), "windowSeconds": seconds})
			return
		}
		if r.URL.Path == "/demo/time" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"serverTime": time.Now().UnixMilli()})
			return
		}
		if r.URL.Path == "/demo/server" {
			w.Header().Set("Content-Type", "application/json")
			client := &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
			response, err := client.Get(strings.TrimRight(s.BackendURL, "/") + "/internal/status")
			if err != nil {
				w.WriteHeader(503)
				w.Write([]byte(`{"online":false,"error":"Task API is unreachable"}`))
				return
			}
			defer response.Body.Close()
			if response.StatusCode != 200 {
				w.WriteHeader(503)
				w.Write([]byte(`{"online":false,"error":"Backend health endpoint unavailable"}`))
				return
			}
			io.Copy(w, io.LimitReader(response.Body, 32768))
			return
		}
		if r.URL.Path == "/demo/state" {
			now := time.Now()
			interval := now.Unix() / int64(seconds)
			s.mu.Lock()
			defer s.mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"serverTime": now.UnixMilli(), "windowSeconds": seconds, "interval": interval,
				"nextRotation": (interval + 1) * int64(seconds) * 1000,
				"tokens":       map[string]string{"current": mutation.Token(seed, interval), "previous": mutation.Token(seed, interval-1), "expired": mutation.Token(seed, interval-3), "future": mutation.Token(seed, interval+1)},
				"events":       s.events, "started": s.started,
				"counts": map[string]int64{"total": s.total, "forwarded": s.forwarded, "blocked": s.blocked, "backendResponses": s.backendResponses},
			})
			return
		}
		if r.URL.Path == "/client" {
			http.Redirect(w, r, "/client/", http.StatusTemporaryRedirect)
			return
		}
		if r.URL.Path == "/client/" {
			r = r.Clone(r.Context())
			r.URL.Path = "/client.html"
		}
		allowed := map[string]bool{"/": true, "/app.js": true, "/style.css": true, "/client.html": true, "/client.js": true, "/client.css": true, "/mutation.js": true, "/server-monitor.js": true, "/server-monitor.css": true}
		if !allowed[r.URL.Path] {
			http.NotFound(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
}

func ValidateAddress(address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil || !isLoopbackHost(net.JoinHostPort(host, port)) {
		return fmt.Errorf("DEMO_UI requires a loopback LISTEN_ADDR")
	}
	return nil
}

func isLoopbackHost(hostPort string) bool {
	host, port, err := net.SplitHostPort(hostPort)
	if err != nil {
		return false
	}
	if parsedPort, err := strconv.Atoi(port); err != nil || parsedPort < 1 || parsedPort > 65535 {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
