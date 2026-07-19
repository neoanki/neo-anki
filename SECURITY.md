# Security policy

## Supported versions

Neo Anki is pre-1.0. Security fixes are applied to the latest release and the `main` branch.

Local developer builds are unsigned. Tagged desktop releases require platform signing and are updated manually; verify downloaded artifacts against the release's SHA-256 file or GitHub provenance attestation. Neo Anki does not download or install application updates.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for `neoanki/neo-anki`. Do not open a public issue for a suspected vulnerability. Include affected versions, reproduction steps, impact, and any suggested mitigation.

We aim to acknowledge a report within three business days, provide an initial assessment within seven days, and coordinate disclosure after a fix is available. We will credit reporters unless they prefer anonymity.

## Scope

The Electron main process, preload bridge, persistence and backup formats, importers, release distribution and provenance, extension package loader, and SDK capability boundary are all in scope.

Every locally installed extension must use schema/SDK 2. Non-UI code runs in a bounded worker and UI in an opaque-origin sandboxed iframe; bypassing package/signature validation, capability checks, worker/iframe containment, patch validation, safe-mode recovery, or the renderer’s Electron/OS sandbox is in scope. Bundled feature modules are trusted application code, not installable extensions.
