# Neo Anki desktop architecture

Neo Anki's MVP is an Electron desktop application. Vite remains a renderer development tool, but production does not require a browser tab or local HTTP server.

## Process boundary

- The main process owns the application window, filesystem persistence, native backup dialog, navigation policy, and permission policy.
- The renderer owns React UI and learning behavior. It runs with `nodeIntegration: false`, context isolation, and Chromium sandboxing.
- The preload script exposes narrow workspace persistence and extension-lifecycle operations. Extension package selection always uses a native file dialog; arbitrary filesystem reads are not exposed.
- Generic IPC, Node primitives, renderer-selected filesystem paths, and shell execution are never exposed to the renderer.

## Persistence

The main process stores `neo-anki.sqlite` under Electron's OS-specific `userData` directory. SQLite runs in WAL mode with full synchronous durability, foreign keys, a busy timeout, schema-version metadata, and normalized tables for knowledge, cards, review events, assets, planning state, conflicts, and Trash. Renderer saves are converted to incremental change sets and applied in one transaction.

Media bytes are stored separately from renderer records inside the database. Every asset is addressed through the private `neoanki-media://` protocol and verified against its declared byte length and SHA-256 digest when loaded.

Neo Anki takes rotating local-day online backups and a backup before destructive replacement. Restore validates SQLite integrity, schema compatibility, required tables, media digests, and the complete semantic workspace before changing the current database. If opening the primary database fails, the damaged file is preserved and automatic backups are tried newest-to-oldest until one validates. Existing `neo-anki-data.json` workspaces are migrated once and preserved verbatim in the backup directory. The Settings panel reports migration, recovery, and persistence failures instead of silently presenting them as successful saves.

Only one process may own the workspace at a time. A second launch focuses the existing window instead of opening the database concurrently.

## Packaged content

Production assets load from the privileged `neoanki://app/` protocol rather than a remote website. Navigation outside that origin is blocked. Explicit HTTPS and mail links open in the operating system browser, and renderer permission requests are denied by default.

Reviewed SDK 2 iframe assets load from the separate `neoanki-extension://` protocol. The main process resolves each request against the active fingerprinted package directory and rejects disabled extensions, unreviewed entries, digest mismatches, missing files, traversal paths and every non-v2 manifest. No extension React bridge or same-context module loader exists.

Extension archives and lifecycle state live under `userData/extensions/`. Package contents are size/path/manifest validated and require a valid Ed25519 signature matching the reviewed publisher key before being written. A new fingerprinted directory is made durable before the active state pointer changes; state updates keep a recovery copy during replacement. Identical reinstall is idempotent.

Marketplace discovery uses the public `neoanki/extensions` catalog, but the renderer never supplies an arbitrary download URL. The main process re-fetches the approved id/version, enforces the catalog/package size limits and minimum app version, restricts the immutable GitHub Release source and redirect hosts, verifies SHA-256, stages the signed package, and requires signed manifest identity, publisher key and permissions to match the listing before returning it for user review.

SDK v2 non-UI logic is not loaded as a package URL or blob under the renderer’s ordinary CSP. The main process serves the exact reviewed worker entry through `neoanki://app/__extension-worker.js` with a no-network CSP and a lockdown prelude that removes ambient fetch, sockets, storage, nested workers and realtime APIs. SDK v2 UI uses opaque-origin `sandbox="allow-scripts"` frames with `connect-src 'none'`; data and effects cross bounded message channels only.

Bundled feature modules are trusted application code and use an internal core-module registry, not the installable SDK. Only signed SDK 2 packages cross the extension package boundary.

The main process independently watches renderer startup. If extension loading prevents the renderer from reporting ready, Neo Anki destroys only the failed window and opens a fresh safe-mode window without locally installed extensions. The database and main process remain open, the incident is recorded in the privacy-limited diagnostic log, and Settings lets the user restart normally after disabling or removing the package.
