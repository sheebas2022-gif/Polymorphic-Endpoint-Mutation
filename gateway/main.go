package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"time"

	"polymorphic-api-gateway/gateway/demo"
	"polymorphic-api-gateway/gateway/middleware"
)

func main() {
	seed := []byte(os.Getenv("MUTATION_SEED"))
	if len(seed) < 32 {
		log.Fatal("MUTATION_SEED must contain at least 32 UTF-8 bytes")
	}
	seconds := 30
	if value := os.Getenv("WINDOW_SECONDS"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 86400 {
			log.Fatal("WINDOW_SECONDS must be 1..86400")
		}
		seconds = parsed
	}
	upstream := os.Getenv("BACKEND_URL")
	if upstream == "" {
		upstream = "http://127.0.0.1:9000"
	}
	target, err := url.Parse(upstream)
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" || target.User != nil || target.RawQuery != "" || target.Fragment != "" || (target.Path != "" && target.Path != "/") {
		log.Fatal("BACKEND_URL must be an HTTP(S) origin without credentials, query, or path")
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			r.SetXForwarded()
		},
		Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, MaxIdleConns: 100, IdleConnTimeout: 90 * time.Second, ResponseHeaderTimeout: 15 * time.Second, TLSHandshakeTimeout: 10 * time.Second},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}
	var downstream http.Handler = proxy
	var telemetry *demo.Store
	if os.Getenv("DEMO_UI") == "1" {
		telemetry = demo.New()
		telemetry.BackendURL = target.String()
		downstream = telemetry.Forward(proxy)
		proxy.ModifyResponse = demo.BackendResponse
	}
	handler := middleware.Mutator(seed, time.Duration(seconds)*time.Second, time.Now, downstream)
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8080"
	}
	if telemetry != nil {
		if err := demo.ValidateAddress(address); err != nil {
			log.Fatal(err)
		}
		handler = telemetry.Handler(seed, seconds, telemetry.Wrap(handler))
		log.Print("Local demo dashboard enabled; route tokens are exposed for testing")
	}
	server := &http.Server{Addr: address, Handler: http.MaxBytesHandler(handler, 1<<20), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	log.Printf("gateway listening on %s", address)
	log.Fatal(server.ListenAndServe())
}
