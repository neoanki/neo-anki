# Neo Anki desktop architecture

Neo Anki's MVP is an Electron desktop application. Vite remains a renderer development tool, but production does not require a browser tab or local HTTP server.

## Process boundary

- The main process owns the application window, filesystem persistence, native backup dialog, navigation policy, and permission policy.
- The renderer owns React UI and learning behavior. It runs with `nodeIntegration: false`, context isolation, and Chromium sandboxing.
- The preload script exposes narrow workspace persistence and extension-lifecycle operations. Extension package selection always uses a native file dialog; arbitrary filesystem reads are not exposed.
- Generic IPC, Node primitives, renderer-selected filesystem paths, and shell execution are never exposed to the renderer.

## Persistence

The main process stores `neo-anki.sqlite` under Electron's OS-specific `userData` directory. Schema 6 uses SQLite WAL mode with full synchronous durability, foreign keys, a busy timeout, and schema-version metadata. A validated Workspace v4 snapshot is the canonical checkpoint. Ordinary mutations append an integrity-hashed `changes` or `core-patch` record to `workspace_journal` in one transaction instead of rewriting the complete graph. Startup replays that journal in order and refuses/quarantines a row whose stored SHA-256 does not match its payload.

The renderer sends immutable incremental change sets. Same-turn updates are coalesced, later in-flight updates are cumulative from the last durable snapshot, and the main process serializes their transactions. A failed earlier mutation therefore cannot make a later acknowledged mutation depend on missing state. Explicit v4 commands flush accepted renderer saves first. Template/preset IPC returns only affected definitions, rendering-card identifiers, and deck membership; the renderer applies that narrow projection optimistically and reports failures without replacing unrelated state.

Checkpointing compacts the snapshot and journal during replacement, import, restore, or migration. Automatic online backup is limited to one validated copy per local day rather than copying the database after every small mutation. Exported backups include the snapshot, journal, media, and receipts, so restoring and replaying a backup reaches the same latest durable revision.

Media bytes are stored separately from renderer records inside the database. Every asset is addressed through the private `neoanki-media://` protocol and verified against its declared byte length and SHA-256 digest when loaded.

Neo Anki takes rotating local-day online backups and a backup before destructive replacement. Restore accepts schema 4/5 checkpoints and schema 6 snapshot-plus-journal databases, then validates SQLite integrity, schema compatibility, required tables, journal hashes, media digests, and the complete semantic workspace before changing the current database. If opening the primary database fails, the damaged file is preserved and automatic backups are tried newest-to-oldest until one validates. Corrupt journal entries block loading rather than silently dropping acknowledged operations.

Existing `neo-anki-data.json` workspaces remain usable through a structurally checked projection while a worker performs full migration and validation after the first useful paint. The original JSON is copied to the recovery directory before migration; the canonical snapshot is committed only after validation succeeds. Interrupted or rejected migrations leave that source untouched and retryable. Any mutation, backup/export, sync, or v4 editor request waits for migration completion before it can acknowledge success. The Settings panel reports migration, recovery, and persistence failures instead of silently presenting them as successful saves.

Only one process may own the workspace at a time. A second launch focuses the existing window instead of opening the database concurrently.

## Native card presentation

Cards are stored as references to a content record and a structured card template. Content types own named fields; each template selects one prompt field, one answer field, optional supporting fields, and either reveal or typed-answer interaction. The shared card-rendering package projects those records into inert structured text.

Review, Library, authoring preview, Electron projection, and the native mobile client consume that same projection. Core card content never executes template markup, creates an iframe or WebView, injects CSS, or stores a second rendered HTML cache. Older external template markup is converted to native field values at the import boundary; export compatibility metadata remains isolated in source envelopes.

## Packaged content

Production assets load from the privileged `neoanki://app/` protocol rather than a remote website. Navigation outside that origin is blocked. Explicit HTTPS and mail links open in the operating system browser, and renderer permission requests are denied by default.

Reviewed executable SDK 2 iframe assets load from the separate `neoanki-extension://` protocol. The main process resolves each request against the active fingerprinted package directory and rejects disabled extensions, unreviewed entries, digest mismatches, missing files, traversal paths and every non-v2 manifest. Extension Configure screens are host-rendered React forms built from validated inert manifest data; they do not request an extension asset or create a frame. No extension React bridge or same-context module loader exists.

Extension archives and lifecycle state live under `userData/extensions/`. Package contents are size/path/manifest validated and require a valid Ed25519 signature matching the reviewed publisher key before being written. A new fingerprinted directory is made durable before the active state pointer changes; state updates keep a recovery copy during replacement. Identical reinstall is idempotent.

Marketplace discovery uses the public `neoanki/extensions` catalog, but the renderer never supplies an arbitrary download URL. The main process re-fetches the approved id/version, enforces the catalog/package size limits and minimum app version, restricts the immutable GitHub Release source and redirect hosts, verifies SHA-256, stages the signed package, and requires signed manifest identity, publisher key and permissions to match the listing before returning it for user review.

SDK v2 non-UI logic is not loaded as a package URL or blob under the renderer’s ordinary CSP. The main process serves the exact reviewed worker entry through `neoanki://app/__extension-worker.js` with a no-network CSP and a lockdown prelude that removes ambient fetch, sockets, storage, nested workers and realtime APIs. Executable SDK v2 UI uses opaque-origin `sandbox="allow-scripts"` frames with `connect-src 'none'`; data and effects cross bounded message channels only. Declarative settings have no worker, command, message, or network path: core reads/writes synchronized config atomically and exposes only status plus explicit mutation for device secrets.

Core contains no trusted optional-feature registry. More Card Types, Image Occlusion, Anki & CSV Import/Export, Review Priorities, Goals & Saved Searches, Learning Packs, Card Timer, Collection Insights, and Text to Speech all cross the same signed SDK 2 package boundary as third-party extensions.

The main process independently watches renderer startup. If extension loading prevents the renderer from reporting ready, Neo Anki destroys only the failed window and opens a fresh safe-mode window without locally installed extensions. The database and main process remain open, the incident is recorded in the privacy-limited diagnostic log, and Settings lets the user restart normally after disabling or removing the package.
