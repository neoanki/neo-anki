# Releasing Neo Anki

Release artifacts are built only by `.github/workflows/release.yml`. Local packages are useful for smoke testing, but are not release artifacts.

## Trust model

Releases require no paid certificate and no release secret. They deliberately make the platform trust state visible:

- macOS DMG and ZIP builds are unsigned and unnotarized. CI confirms that Gatekeeper does not treat them as Developer ID software, then launches the packaged app directly for a smoke test. Users follow the included Open Anyway instructions once per installed release.
- Windows EXE installers are unsigned. CI confirms the Authenticode state is `NotSigned`, then launches the packaged executable. Users follow the included SmartScreen instructions.
- Linux AppImages are extracted and structurally verified before a packaged-app smoke test.

Every platform artifact is accompanied by platform-specific installation guidance, deterministic SHA-256 checksums, a CycloneDX SBOM, and GitHub build-provenance attestations. Only top-level distributable files are uploaded; unpacked staging directories and automatic-update metadata are excluded.

Release filenames are normalized before hashing. After the draft is uploaded, CI downloads all expected assets again and fails unless every checksum, SBOM, and primary artifact attestation still verifies under its final GitHub filename.

Automatic application updates are disabled. An unsigned application must not silently install unsigned remote code. Users download each release manually and verify its checksum or attestation.

## Release sequence

1. Merge a version change and `docs/releases/vX.Y.Z.md` through protected `main`.
2. Create and push a signed `vX.Y.Z` tag matching `package.json`.
3. Wait for the release workflow to finish on macOS universal, Windows x64, and Linux x64.
4. Inspect the release notes, checksums, CycloneDX SBOMs, build attestations, installers, and included installation guidance in the generated draft GitHub Release.
5. Install each artifact on a clean machine using the same documented override users will see. Verify onboarding, a review, restart persistence, backup export, and backup restore.
6. Verify an artifact with `gh attestation verify <artifact> --repo neoanki/neo-anki`, then publish the draft.

## Rollback

Do not replace an existing release asset or reuse a version. If a release is bad, unpublish it and ship a higher patch version containing the rollback or fix. Users who already updated need a numerically newer version. Preserve the withdrawn release’s checksums and incident notes for auditability.

Never edit or replace a published artifact. GitHub attestations and checksums intentionally make replacement detectable.
