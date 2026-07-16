# Neo Anki desktop architecture

Neo Anki's MVP is an Electron desktop application. Vite remains a renderer development tool, but production does not require a browser tab or local HTTP server.

## Process boundary

- The main process owns the application window, filesystem persistence, native backup dialog, navigation policy, and permission policy.
- The renderer owns React UI and learning behavior. It runs with `nodeIntegration: false`, context isolation, and Chromium sandboxing.
- The preload script exposes only four operations: load workspace, save workspace, export backup, and reset workspace.
- Generic IPC, Node primitives, filesystem paths chosen by web content, and shell execution are never exposed to the renderer.

## Persistence

The main process stores `neo-anki-data.json` under Electron's OS-specific `userData` directory. Every save is serialized and written to a temporary file before an atomic rename. Before replacing an existing workspace, the previous valid file becomes `neo-anki-data.recovery.json`.

If the primary file cannot be parsed, Neo Anki preserves a timestamped copy of the corrupt file and attempts to open the recovery copy. The Settings panel reports recovery and persistence failures instead of silently presenting them as successful saves.

This file-backed store is appropriate for the first desktop MVP. Moving media blobs to a content-addressed directory and normalized durable records to SQLite can happen behind the same renderer bridge without changing the UI or extension API.

## Packaged content

Production assets load from the privileged `neoanki://app/` protocol rather than a remote website. Navigation outside that origin is blocked. Explicit HTTPS and mail links open in the operating system browser, and renderer permission requests are denied by default.
