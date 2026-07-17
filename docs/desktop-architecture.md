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

Neo Anki takes rotating daily online backups and a backup before destructive replacement. Restore validates SQLite integrity, schema compatibility, required tables, and the complete semantic workspace before changing the current database. If opening the primary database fails, the damaged file is preserved and the latest verified automatic backup is recovered. Existing `neo-anki-data.json` workspaces are migrated once and preserved verbatim in the backup directory. The Settings panel reports migration, recovery, and persistence failures instead of silently presenting them as successful saves.

Only one process may own the workspace at a time. A second launch focuses the existing window instead of opening the database concurrently.

## Packaged content

Production assets load from the privileged `neoanki://app/` protocol rather than a remote website. Navigation outside that origin is blocked. Explicit HTTPS and mail links open in the operating system browser, and renderer permission requests are denied by default.

Enabled local extensions load from the separate `neoanki-extension://` protocol. The main process resolves each request against the active fingerprinted package directory and rejects disabled extensions, missing files, and traversal paths. Stable `neoanki://app/extension-host/` modules provide the application’s React and JSX runtimes, preventing duplicate-React hook failures.

Extension archives and lifecycle state live under `userData/extensions/`. Package contents are size/path/manifest validated before being written. A new fingerprinted directory is made durable before the active state pointer changes; state updates keep a recovery copy during replacement.

The Electron renderer remains sandboxed without Node integration, and CSP blocks arbitrary remote scripts and connections. The remaining extension-code isolation work is tracked as a release blocker: package JavaScript must execute behind the same capability broker for every publisher rather than inside the application renderer.
