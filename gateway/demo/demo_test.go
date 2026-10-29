package demo

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"
	"time"

	mutation "polymorphic-api-gateway/gateway/crypto"
	"polymorphic-api-gateway/gateway/middleware"
)

func TestDashboardRecordsRealPipeline(t *testing.T) {
	seed := []byte("0123456789abcdef0123456789abcdef")
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/checkout" {
			t.Errorf("unexpected backend path: %s", r.URL.Path)
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	defer backend.Close()
	target, _ := url.Parse(backend.URL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ModifyResponse = BackendResponse
	store := New()
	api := middleware.Mutator(seed, time.Minute, time.Now, store.Forward(proxy))
	handler := store.Handler(seed, 60, store.Wrap(api))
	call := func(path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "http://127.0.0.1:8080"+path, nil)
		r.Header.Set("X-Demo-Request-ID", "test-correlation")
		r.Header.Set("X-Demo-Source", "client")
		r.Header.Set("X-Demo-Page-ID", "stable-document")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	token := mutation.Token(seed, time.Now().Unix()/60)
	if w := call("/api/v1/" + token + "/checkout"); w.Code != 200 {
		t.Fatalf("valid request: %d", w.Code)
	}
	if w := call("/api/v1/checkout"); w.Code != 404 {
		t.Fatalf("static request: %d", w.Code)
	}
	if w := call("/"); w.Code != 200 || !strings.Contains(w.Body.String(), "Every request. Both sides.") || strings.Contains(w.Body.String(), "id=\"send\"") {
		t.Fatal("embedded dashboard not served")
	}
	w := call("/demo/state")
	var snapshot struct {
		Events []Event           `json:"events"`
		Counts map[string]int    `json:"counts"`
		Tokens map[string]string `json:"tokens"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Counts["total"] != 2 || snapshot.Counts["forwarded"] != 1 || snapshot.Counts["blocked"] != 1 || snapshot.Counts["backendResponses"] != 1 {
		t.Fatalf("incorrect counters: %+v", snapshot.Counts)
	}
	if snapshot.Events[0].BackendAttempted || snapshot.Events[0].BackendResponded {
		t.Fatal("blocked request claimed backend activity")
	}
	if snapshot.Events[1].Source != "client" || snapshot.Events[1].PageID != "stable-document" || snapshot.Events[1].ResponseBody != `{"ok":true}` {
		t.Fatal("client monitoring metadata missing")
	}
	if w := call("/client/"); w.Code != 200 || !strings.Contains(w.Body.String(), "Good moments.") {
		t.Fatal("client website unavailable")
	}
	if !snapshot.Events[1].BackendResponded || snapshot.Events[1].Forwarded != "/api/v1/checkout" || snapshot.Events[1].RequestID != "test-correlation" {
		t.Fatalf("incorrect forwarded trace: %+v", snapshot.Events[1])
	}
	if snapshot.Tokens["current"] != token || strings.Contains(w.Body.String(), string(seed)) {
		t.Fatal("token mismatch or seed exposed")
	}
}

func TestDemoAccessRestrictions(t *testing.T) {
	handler := New().Handler([]byte("0123456789abcdef0123456789abcdef"), 60, http.NotFoundHandler())
	for _, test := range []struct {
		host, origin string
		status       int
	}{
		{"127.0.0.1:8080", "", 200},
		{"localhost:8080", "http://localhost:8080", 200},
		{"evil.example:8080", "", 403},
		{"127.0.0.1:8080", "https://evil.example", 403},
	} {
		r := httptest.NewRequest("GET", "http://"+test.host+"/demo/state", nil)
		r.Header.Set("Origin", test.origin)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Errorf("host %s origin %s: got %d", test.host, test.origin, w.Code)
		}
	}
	if ValidateAddress("0.0.0.0:8080") == nil {
		t.Fatal("demo allowed public bind")
	}
}
