# Releasing Neo Anki

Production artifacts are built only by `.github/workflows/release.yml`. Local packages are useful for smoke testing, but are not release artifacts.

## Required repository secrets

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE_BASE64` | Developer ID Application certificate exported as base64 PKCS#12 |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password |
| `APPLE_ID` | Apple notarization account |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password |
| `APPLE_TEAM_ID` | Apple Developer team identifier |
| `WINDOWS_CERTIFICATE_BASE64` | Authenticode certificate exported as base64 PKCS#12 |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows certificate password |

The workflow fails when signing is unavailable. It verifies macOS code signing, Gatekeeper acceptance, notarization stapling, Windows Authenticode, and the Linux AppImage payload before uploading anything.

## Release sequence

1. Merge a version change and release notes through protected `main`.
2. Create and push a signed `vX.Y.Z` tag matching `package.json`.
3. Wait for the release workflow to finish on macOS universal, Windows x64, and Linux x64.
4. Inspect checksums, CycloneDX SBOMs, build attestations, installers, and update metadata in the generated draft GitHub Release.
5. Install and launch each artifact on a clean machine. Verify onboarding, a review, restart persistence, backup restore, and update detection.
6. Publish the draft. `electron-updater` never consumes draft releases.

Application updates are opt-in: Neo Anki checks the stable GitHub release channel, asks before download, verifies platform signatures and update hashes, creates a workspace backup, then asks before restart/install.

## Rollback

Do not replace an existing release asset or reuse a version. If a release is bad, unpublish it and ship a higher patch version containing the rollback or fix. Users who already updated need a numerically newer version. Preserve the withdrawn release’s checksums and incident notes for auditability.

For a staged rollout, add `stagingPercentage` to the generated channel metadata before publishing. Increase it gradually; never edit an artifact after publication.
