# Encrypted sync service operations

The reference service stores account/workspace routing metadata, device public keys, signed encrypted operation envelopes, encrypted snapshots and encrypted media chunks. It never receives a collection key or plaintext collection/media content.

## Run the service

From the repository root:

```bash
export NEO_ANKI_SYNC_ALLOWED_ORIGINS="https://app.example.com"
export NEO_ANKI_SYNC_METRICS_TOKEN="replace-with-at-least-32-random-characters"
docker compose -f deploy/sync/docker-compose.yml up --build -d
```

The container listens only on `127.0.0.1:8787`. Put it behind an HTTPS reverse proxy and forward the original client IP. Set `NEO_ANKI_SYNC_TRUST_PROXY=true` only when every connection reaches the service through that trusted proxy; otherwise forwarded addresses are intentionally ignored. Do not expose the plain HTTP port publicly. Browser clients require their exact HTTPS origin in `NEO_ANKI_SYNC_ALLOWED_ORIGINS`; desktop and native clients are not governed by browser CORS.

Persist and back up the `neo-anki-sync-data` volume. SQLite runs with WAL, foreign keys and full synchronous durability. Backups must include the main database plus its WAL state, preferably through a filesystem snapshot or SQLite online-backup operation. Test restore into an isolated service before considering a backup valid: start the isolated service, check `/health`, compare authenticated operator counts and encrypted byte totals, recover a disposable authorized device, pull/decrypt a known canary workspace, and record the drill date and restore point.

## Limits and abuse controls

- 2,000 signed operations per push and 10,000 per pull page.
- 50 device records, 10 million encrypted operations, five committed encrypted snapshots and 20 GiB of encrypted media per workspace.
- Snapshots are uploaded as independently authenticated 1 MiB chunks and become visible only after an atomic manifest commit. Interrupted uploads remain invisible and are safe to retry; stale uncommitted chunks are removed after 24 hours.
- Each device acknowledges a cursor only after applying and durably storing it. Operations are compacted only when a committed snapshot covers them and every active device has acknowledged that snapshot cursor. Actor sequence watermarks survive compaction, and new or lagging clients are forced through the retained encrypted bootstrap snapshot.
- Snapshot plaintext is capped at 512 MiB, encrypted snapshot storage at 3 GiB, and staged/retained snapshot identities at 12 per workspace. Legacy single-request snapshots are capped at 16 MiB.
- Media uploads use isolated upload identities and an atomic manifest switch, so an interrupted replacement cannot expose a mixture of old and new chunks. Deleted media is reclaimed only after its tombstone is included in a safely compacted snapshot and a 30-day recovery grace period has elapsed.
- 4 MiB plaintext per encrypted media or snapshot chunk and bounded JSON request bodies.
- Per-address enrollment and general request rate limits. A production ingress should add distributed rate limiting, request/body limits and DDoS protection.

Device tokens and recovery authorization are stored only as SHA-256 digests. Revocation blocks future authentication and writes while retaining the public key required to verify historical operations.

## Client crash and network behavior

Desktop and native clients write the encrypted operation journal and resulting Workspace v4 state in one local transaction before acknowledging a remote cursor. Startup replays an incomplete journal idempotently, and a failed acknowledgement never discards local operations. Same-device browser tabs use the identical operation envelopes; `BroadcastChannel` is transport only, not a separate merge algorithm.

The HTTP reference service rejects disallowed browser origins before routing or mutation, caps request bodies, applies request and response timeouts, records content-blind authentication failure metrics, and does not start a listener when imported by tests or operators. Sync remains usable offline; the UI exposes pending operations, conflicts, last success, device/recovery controls and service errors.

For environments where the default registry is unavailable, the service image accepts a build-time `NODE_IMAGE` override while production Compose stays pinned to the reviewed default. Any override becomes a new supply-chain input and must be scanned and recorded with the deployment.

## Monitoring and privacy

Monitor availability, HTTP status counts, latency, database/WAL size, filesystem capacity and backup age at the reverse proxy/container layer. When `NEO_ANKI_SYNC_METRICS_TOKEN` is configured, `GET /v1/operator/metrics` returns authenticated content-blind aggregate counts, encrypted storage totals, staged-transfer counts and acknowledgement age. The route returns 404 when disabled or unauthorized; never expose its token to clients.

Application-level request and enrollment windows are stored in the shared SQLite database, so service processes using the same database enforce one limit. The service also caps accounts, devices, operations, encrypted snapshots/media, request bodies and future clock skew; clients cap response bodies at 64 MiB. Keep stricter shared ingress limits at the reverse proxy, alert on quota/429/413 growth, and never treat the application limiter as volumetric-DDoS protection.

Do not enable request-body logging. Authorization headers, encrypted envelopes and recovery requests must not appear in logs. Collection content is encrypted, but sizes, timing, account/workspace IDs and device identifiers remain metadata and should be treated as private.

## Portability and deletion

Clients retain the protocol, keys and interoperable export capability. The service is replaceable: its wire format is implemented in `packages/sync-protocol`, `packages/sync-client` and the AGPL reference service. Account deletion cascades through devices, operations, snapshots and media. Users should export and verify a local package before deletion.
