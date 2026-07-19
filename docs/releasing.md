# Releasing Neo Anki

Release artifacts are built only by `.github/workflows/release.yml`. Local packages are useful for smoke testing, but are not release artifacts.

## Trust model

Tagged desktop releases require platform signing credentials. The release workflow fails closed when they are missing:

- macOS DMG and ZIP releases require Developer ID signing, hardened runtime, notarization, stapling, Gatekeeper assessment, and a packaged launch smoke test. Missing credentials fail the release job.
- Windows EXE releases require a valid Authenticode signature and a packaged launch smoke test. Missing credentials fail the release job.
- Linux AppImages are extracted and structurally verified before a packaged-app smoke test.

Every platform artifact is accompanied by platform-specific installation guidance, deterministic SHA-256 checksums, a CycloneDX SBOM, and GitHub build-provenance attestations. Only top-level distributable files are uploaded; unpacked staging directories and automatic-update metadata are excluded.

Release filenames are normalized before hashing. After the draft is uploaded, CI downloads all expected assets again and fails unless every checksum, SBOM, and primary artifact attestation still verifies under its final GitHub filename.

Automatic application updates remain disabled until signed update metadata and rollback validation ship. Users download releases manually and can verify checksums and provenance attestations.

## Release sequence

1. Merge a version change and `docs/releases/vX.Y.Z.md` through protected `main`.
2. Create and push a signed `vX.Y.Z` tag matching `package.json`.
3. Wait for the release workflow to finish on macOS universal, Windows x64, and Linux x64.
4. Inspect the release notes, checksums, CycloneDX SBOMs, build attestations, installers, and included installation guidance in the generated draft GitHub Release.
5. Install each artifact on a clean machine without bypassing platform trust. Verify onboarding, a review, restart persistence, backup export, and backup restore.
6. Verify an artifact with `gh attestation verify <artifact> --repo neoanki/neo-anki`, then publish the draft.

Native app-store releases are separate from the desktop GitHub release. Complete `docs/mobile-release-checklist.md` on physical devices before publishing either store binary; an automated Expo export alone is not approval.

## Rollback

Do not replace an existing release asset or reuse a version. If a release is bad, unpublish it and ship a higher patch version containing the rollback or fix. Users who already updated need a numerically newer version. Preserve the withdrawn release’s checksums and incident notes for auditability.

Never edit or replace a published artifact. GitHub attestations and checksums intentionally make replacement detectable.
