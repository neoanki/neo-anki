# Security policy

## Supported versions

Neo Anki is pre-1.0. Security fixes are applied to the latest published release candidate and the `main` branch.

Desktop community releases are intentionally unsigned and update manually. Verify downloaded artifacts against the release's SHA-256 file or GitHub provenance attestation. Neo Anki does not download or install application updates from inside an unsigned build.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for `neoanki/neo-anki`. Do not open a public issue for a suspected vulnerability. Include affected versions, reproduction steps, impact, and any suggested mitigation.

We aim to acknowledge a report within three business days, provide an initial assessment within seven days, and coordinate disclosure after a fix is available. We will credit reporters unless they prefer anonymity.

## Scope

The Electron main process, preload bridge, persistence and backup formats, importers, update mechanism, extension package loader, and SDK capability boundary are all in scope.

Locally installed SDK v1 extensions are an explicit full-trust code boundary. Installing a malicious extension is not itself a sandbox escape; bypassing the install review, package validation, publisher warning, safe-mode recovery, or the renderer’s Electron/OS sandbox is in scope. Contribution permission declarations restrict registry activation but are not advertised as isolation from deliberately malicious package code.
