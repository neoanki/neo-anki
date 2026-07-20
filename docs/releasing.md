# Releasing Neo Anki

Release artifacts are built only by `.github/workflows/release.yml`. Local packages are useful for smoke testing, but are not release artifacts.

## Trust model

Tagged desktop releases do not require platform signing credentials or repository secrets:

- macOS DMG and ZIP payloads are checked and launched in a packaged-app smoke test.
- Windows EXE payloads are checked and launched in a packaged-app smoke test.
- Linux AppImages are extracted and structurally verified before a packaged-app smoke test.

Every platform artifact is accompanied by platform-specific installation guidance, deterministic SHA-256 checksums, a CycloneDX SBOM, and GitHub build-provenance attestations. Only top-level distributable files are uploaded; unpacked staging directories and automatic-update metadata are excluded.

Developer ID signing, Apple notarization, and Windows Authenticode signing are optional future trust improvements. Their absence does not block packaging, CI, or a draft release. Until implemented, release notes and installation guidance must state that macOS and Windows artifacts are unsigned.

Release filenames are normalized before hashing. After the draft is uploaded, CI downloads all expected assets again and fails unless every checksum, SBOM, and primary artifact attestation still verifies under its final GitHub filename.

Automatic application updates remain disabled until signed update metadata and rollback validation ship. Users download releases manually and can verify checksums and provenance attestations.

## Release sequence

1. Merge a version change and `docs/releases/vX.Y.Z.md` through protected `main`.
2. Create and push a `vX.Y.Z` tag matching `package.json`.
3. Wait for the release workflow to finish on macOS universal, Windows x64, and Linux x64.
4. Inspect the release notes, checksums, CycloneDX SBOMs, build attestations, installers, and included installation guidance in the generated draft GitHub Release.
5. Verify checksums and GitHub attestations, then install each artifact on a clean machine using the documented unsigned-app flow. Verify onboarding, a review, restart persistence, backup export, and backup restore.
6. Verify an artifact with `gh attestation verify <artifact> --repo neoanki/neo-anki`, then publish the draft.

Native app-store releases are separate from the desktop GitHub release. Complete `docs/mobile-release-checklist.md` on physical devices before publishing either store binary; an automated Expo export alone is not approval.

## Rollback

Do not replace an existing release asset or reuse a version. If a release is bad, unpublish it and ship a higher patch version containing the rollback or fix. Users who already updated need a numerically newer version. Preserve the withdrawn release’s checksums and incident notes for auditability.

Never edit or replace a published artifact. GitHub attestations and checksums intentionally make replacement detectable.
