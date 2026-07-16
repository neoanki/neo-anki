# Neo Anki desktop architecture

Neo Anki's MVP is an Electron desktop application. Vite remains a renderer development tool, but production does not require a browser tab or local HTTP server.

## Process boundary

- The main process owns the application window, filesystem persistence, native backup dialog, navigation policy, and permission policy.
- The renderer owns React UI and learning behavior. It runs with `nodeIntegration: false`, context isolation, and Chromium sandboxing.
- The preload script exposes narrow workspace persistence and extension-lifecycle operations. Extension package selection always uses a native file dialog; arbitrary filesystem reads are not exposed.
- Generic IPC, Node primitives, renderer-selected filesystem paths, and shell execution are never exposed to the renderer.

## Persistence

The main process stores `neo-anki-data.json` under Electron's OS-specific `userData` directory. Every save is serialized and written to a temporary file before an atomic rename. Before replacing an existing workspace, the previous valid file becomes `neo-anki-data.recovery.json`.

If the primary file cannot be parsed, Neo Anki preserves a timestamped copy of the corrupt file and attempts to open the recovery copy. The Settings panel reports recovery and persistence failures instead of silently presenting them as successful saves.

This file-backed store is appropriate for the first desktop MVP. Moving media blobs to a content-addressed directory and normalized durable records to SQLite can happen behind the same renderer bridge without changing the UI or extension API.

## Packaged content

Production assets load from the privileged `neoanki://app/` protocol rather than a remote website. Navigation outside that origin is blocked. Explicit HTTPS and mail links open in the operating system browser, and renderer permission requests are denied by default.

Enabled local extensions load from the separate `neoanki-extension://` protocol. The main process resolves each request against the active fingerprinted package directory and rejects disabled extensions, missing files, and traversal paths. Stable `neoanki://app/extension-host/` modules provide the application’s React and JSX runtimes, preventing duplicate-React hook failures.

Extension archives and lifecycle state live under `userData/extensions/`. Package contents are size/path/manifest validated before being written. A new fingerprinted directory is made durable before the active state pointer changes; state updates keep a recovery copy during replacement.

The Electron renderer remains sandboxed without Node integration, and CSP blocks arbitrary remote scripts and connections. Local extension JavaScript is nonetheless trusted in-process renderer code, not a hostile-code sandbox; the install review states this explicitly.
