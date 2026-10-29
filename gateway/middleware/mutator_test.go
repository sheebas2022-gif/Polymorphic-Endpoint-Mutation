package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"
	"time"

	mutation "polymorphic-api-gateway/gateway/crypto"
)

func TestValidationAndForwarding(t *testing.T) {
	seed := []byte("0123456789abcdef0123456789abcdef")
	now := time.Unix(1700000040, 0)
	interval := now.Unix() / 60
	calls := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		body, _ := io.ReadAll(r.Body)
		if r.URL.RequestURI() != "/api/v1/checkout?currency=INR" || r.Method != "POST" || string(body) != "order=123" || r.Header.Get("Authorization") != "Bearer test" {
			t.Errorf("forwarding changed request: %s %s %s", r.Method, r.URL, body)
		}
		w.Header().Set("X-Backend", "yes")
		w.WriteHeader(201)
		w.Write([]byte("accepted"))
	}))
	defer backend.Close()
	target, _ := url.Parse(backend.URL)
	handler := Mutator(seed, time.Minute, func() time.Time { return now }, httputil.NewSingleHostReverseProxy(target))
	current := mutation.Token(seed, interval)
	for _, tc := range []struct {
		name, path string
		status     int
	}{
		{"current", "/api/v1/" + current + "/checkout", 201},
		{"previous", "/api/v1/" + mutation.Token(seed, interval-1) + "/checkout", 201},
		{"expired", "/api/v1/" + mutation.Token(seed, interval-2) + "/checkout", 404},
		{"future", "/api/v1/" + mutation.Token(seed, interval+1) + "/checkout", 404},
		{"static", "/api/v1/checkout", 404},
		{"invalid", "/api/v1/00000000/checkout", 404},
		{"encoded", "/api/v1/" + current + "/%63heckout", 404},
		{"traversal", "/api/v1/" + current + "/../checkout", 404},
		{"empty", "/api/v1/" + current + "//checkout", 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := calls
			r := httptest.NewRequest("POST", tc.path+"?currency=INR", strings.NewReader("order=123"))
			r.Header.Set("Authorization", "Bearer test")
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("got %d, want %d", w.Code, tc.status)
			}
			if tc.status == 404 && calls != before {
				t.Fatal("rejected request reached backend")
			}
			if tc.status == 201 && (w.Body.String() != "accepted" || w.Header().Get("X-Backend") != "yes") {
				t.Fatal("response not preserved")
			}
		})
	}
}
