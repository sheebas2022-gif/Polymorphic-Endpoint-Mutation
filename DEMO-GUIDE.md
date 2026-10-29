# Encore: event-booking demonstration

Requires Go 1.22+ and Node.js 24+. No npm install or virtual environment is needed.
On Windows double-click `start-demo.cmd`, or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1
```

The launcher starts the Node API on 127.0.0.1:9000 and Go gateway on 127.0.0.1:8080. It selects a 30-second window and prints process IDs. It will not stop unrelated programs occupying those ports. If 8080 is occupied, use `-ListenPort 8081`; the launcher prints the resulting URLs.

## Present the demo

1. Open http://127.0.0.1:8080/client/ for Encore.
2. Open http://127.0.0.1:8080/ alongside it for the read-only monitor.
3. Search events or filter by category/city. Every search reaches the real backend.
4. Open an event and choose up to six seats. Enter a sample attendee name.
5. Leave the dialog open for more than 30 seconds. Availability refreshes every five seconds through changing API URLs, without resetting your selection or name.
6. Confirm the demo booking. The server checks availability and saves the reservation atomically.
7. In My tickets, see the reference, event, seats, attendee, and total. Refreshing the page preserves bookings.
8. Cancel a reservation and confirm the dialog. It remains in your history as cancelled and releases the seats.
9. On the monitor, inspect incoming tokenised URLs, stable backend URLs, response previews, blocked traffic, booking count, writes, and backend health.
10. Use **Request token** on the client to choose valid, previous-window, invalid, expired, future, or missing-token behaviour. The selected mode applies to all event and booking API calls. The same selector is inside the booking dialog. Valid and previous tokens are accepted; the other modes return gateway 404s without backend invocation. Previously loaded content remains visible, and switching back to valid refreshes it. Configuration/clock polling is intentionally unaffected; page reload resets the mode to valid.

## Real behaviour and limitations

- Six fictional events have 48 seats each. There is no external event provider, payment, email, or valid admission ticket.
- Booking data lives in `data/bookings.json`. Existing `data/tasks.json` and legacy task APIs are retained for compatibility but are not exposed in the client UI.
- Server-side serialized writes prevent double-booking. Booking request IDs deduplicate retries. Cancellation is idempotent.
- Selections are not temporary holds: availability is checked at confirmation. Another browser may book your chosen seats first.
- A browser ID in local storage groups My tickets. This is a demo convention, NOT authentication or access control. Clearing storage loses that browser's link to its reservations. Use sample data only.
- Tokens use the existing HMAC-SHA256 mechanism and current/previous-window acceptance. All event and booking calls use dynamic endpoints.
- Demo configuration intentionally exposes the seed to the browser. Mutation is route obfuscation, not authentication. Public deployment requires real identity, authorization, TLS, rate limits, and network isolation.
- Backend and gateway bind to loopback. The monitor retains up to 100 events and 8 KiB response previews. Backend logs contain up to 30 recent requests; health polls are not counted.
- This JSON-file server supports a single backend process, not a distributed deployment.

## Verification

```powershell
go test ./...
node --test tests/*.test.ts
```

For the live gateway integration test, set `E2E_ORIGIN=http://127.0.0.1:8080`, `WINDOW_SECONDS=30`, and `MUTATION_SEED=0123456789abcdef0123456789abcdef` in the test shell. That seed is public demo data.

Transfer the project without `.tools` or `.run`, install Go and Node on the destination, and run the launcher. Include `data` only if you want to transfer saved records.
