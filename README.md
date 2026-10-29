# Polymorphic Endpoint Mutation Gateway

A runnable capstone implementation of time-synchronized API route mutation: a Go reverse proxy, a TypeScript fetch SDK, an Encore event-booking website, and a persistent Node.js booking API. No third-party runtime dependencies. See [DEMO-GUIDE.md](DEMO-GUIDE.md) for the client/server presentation walkthrough.

The SDK rewrites `/api/v1/checkout` to `/api/v1/<token>/checkout`. The gateway validates the token before forwarding the original route. Browser navigation and form state are unaffected because only the background request URL changes.

## Protocol

`interval = floor(unix_seconds / window_seconds)`

`token = hex(HMAC-SHA256(UTF8(seed), UTF8(decimal(interval))))[0:8]`

The default window is 30 seconds. Current and previous intervals are accepted, so a token is usable for 30–60 seconds depending on when it was obtained. Future intervals are rejected. This is deterministic cryptographic routing, not a chaotic algorithm or a single-use token. A shared interoperability vector: seed `0123456789abcdef0123456789abcdef`, interval `28333333`, token `6f12b8ed`.

## Run locally

Install Go 1.22+ and Node.js 24+. Run from this directory in three PowerShell terminals. Use the same seed in the gateway and client; the following public seed is for local demonstration only.

If using the project-local Go installation in `.tools/go`, add it to the current PowerShell session before running the Go commands:

```powershell
$env:Path = "$(Get-Location)\.tools\go\bin;$env:Path"
$env:GOCACHE = "$(Get-Location)\.tools\go-cache"
```

Terminal 1 — backend:

```powershell
node api-server/server.js
```

Terminal 2 — gateway:

```powershell
$env:MUTATION_SEED = '0123456789abcdef0123456789abcdef'
$env:DEMO_UI = '1'
go run ./gateway
```

Open **http://127.0.0.1:8080/client/** for Encore: discover fictional events, search by city/category, choose seats, confirm demo reservations, and manage My tickets. No API testing controls are shown to visitors. Open **http://127.0.0.1:8080** alongside it for the read-only monitor: health, rotating routes, client → gateway → backend traces, responses, and activity.

Alternatively, start both processes from one PowerShell terminal with `./scripts/start-demo.ps1`. It builds the gateway, uses the project-local Go installation if available, checks for occupied ports, and prints the process IDs and log locations. If the default port is occupied, pass `-ListenPort 8081` (or another free loopback port).

The client at `/client/`, dashboard, and `/demo/*` routes exist only with `DEMO_UI=1`, which requires a loopback bind on port 8080. The demo client bootstrap exposes the shared seed so the browser can compute HMAC tokens. The dashboard retains the last 100 events, including response previews capped at 8 KiB, for cross-tab monitoring. Counters reset on process restart; saved bookings survive in `data/bookings.json` (legacy task data is preserved separately). “Forwarded” counts proxy attempts; “backend responses” counts actual upstream HTTP responses. Use sample data only. Server metrics and its own clean-path request log are shown separately from gateway telemetry.

For the gateway without the teaching UI, unset `DEMO_UI` or set it to `0`.

Terminal 3 — tests:

```powershell
go test ./...
node --test tests/*.test.ts
$env:MUTATION_SEED = '0123456789abcdef0123456789abcdef'
$env:E2E_ORIGIN = 'http://127.0.0.1:8080'
node --test tests/e2e.test.ts
```

Without `E2E_ORIGIN`, the live integration test is explicitly skipped. Go middleware tests run their own HTTP backend and verify rejected requests never reach it. Both languages check the same fixed cryptographic vector.

## Browser integration

Import the TypeScript source through a TypeScript-aware bundler supporting `.ts` imports (or compile with TypeScript's `rewriteRelativeImportExtensions`). Web Crypto requires HTTPS or localhost. Keep the UI and gateway on the same origin; cross-origin CORS is not configured by this example.

```typescript
import { createMutationClient } from './client-sdk/src/index.ts';

const api = createMutationClient({
  gatewayOrigin: window.location.origin,
  seed: sessionRouteSeed, // provided by your own authenticated provisioning flow
});
const response = await api('/api/v1/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ orderId: '123' }),
});
```

Provisioning and business authentication are application responsibilities; this demo has no login flow. The example gateway uses one deployment-wide seed. Per-session seeds require a session lookup and are not implemented. The SDK accepts logical API paths, preserves request options, rejects ambiguous paths, disables caching, and rejects redirects. It does not automatically retry POST requests.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MUTATION_SEED` | Required | At least 32 UTF-8 bytes, identical on both sides |
| `WINDOW_SECONDS` | `30` | Whole seconds, 1–86400; match SDK setting |
| `BACKEND_URL` | `http://127.0.0.1:9000` | Upstream origin, no base path |
| `LISTEN_ADDR` | `127.0.0.1:8080` | Gateway bind address |

The gateway caps request bodies at 1 MiB, sets HTTP timeouts, and returns 404 for invalid routes and 502 for upstream failures. Methods, body, query, and end-to-end headers are proxied; standard hop-by-hop headers are handled by Go's reverse proxy. Encoded path segments and dot segments are deliberately unsupported; encoded query parameters work normally.

## Security and evaluation boundaries

Route mutation is supplemental obfuscation. A browser-held seed is extractable, and a capable bot can run the SDK. Eight hex characters provide only 32 bits of token space. Accepted tokens can be replayed during the tolerance period and are not bound to a user, method, or payload. Use ordinary authentication, authorization, TLS, rate limits, and upstream network isolation. The mock backend has no authentication and must remain local. Do not commit production seeds.

Synchronize clocks (for example using NTP). Clients ahead of the gateway can fail near rollover; the SDK's injectable clock supports a trusted application-provided offset. Seed rotation must be coordinated with clients. Route tokens can appear in proxy logs, so avoid logging full tokenized paths.

Rejected requests cause no backend invocation, but still consume gateway/network resources. Microsecond latency and DDoS prevention are not established claims; measure latency and load in your deployment. This project includes correctness tests, not production load benchmarks.
