# Releasing Neo Anki

Release artifacts are built only by `.github/workflows/release.yml`. Local packages are useful for smoke testing, but are not release artifacts.

## Trust model

Tagged macOS releases use an explicit ad-hoc signature while Developer ID credentials are unavailable. The reviewed entitlements retain the hardened runtime while permitting Electron's pre-signed frameworks. CI verifies the complete signature and runs the packaged clean-core acceptance journey. Ad-hoc signing does not establish publisher identity and does not satisfy Gatekeeper, so users must verify the checksum and GitHub provenance attestation before approving the first launch. Windows and Linux artifacts run the same packaged acceptance journey; Developer ID notarization and Windows Authenticode remain future trust improvements rather than release blockers.

Every platform artifact is accompanied by platform-specific installation guidance, deterministic SHA-256 checksums, a CycloneDX SBOM, and GitHub build-provenance attestations. Only top-level distributable files are uploaded; unpacked staging directories and automatic-update metadata are excluded.

An unsigned macOS payload still blocks release. A verifiable ad-hoc signature is the minimum interim gate; missing Developer ID or notarization credentials do not block publication. Installation guidance must disclose the expected macOS warning and use the operating system's Open/Open Anyway flow without suggesting that ad-hoc signing proves publisher identity.

Release filenames are normalized before hashing. After the draft is uploaded, CI downloads all expected assets again and fails unless every checksum, SBOM, and primary artifact attestation still verifies under its final GitHub filename.

Automatic application updates remain disabled until signed update metadata and rollback validation ship. Users download releases manually and can verify checksums and provenance attestations.

## Release sequence

1. Merge a version change and `docs/releases/vX.Y.Z.md` through protected `main`.
2. Create and push a `vX.Y.Z` tag matching `package.json`.
3. Wait for the release workflow to finish on macOS universal, Windows x64, and Linux x64.
4. Inspect the release notes, checksums, CycloneDX SBOMs, build attestations, installers, and included installation guidance in the generated draft GitHub Release.
5. Verify checksums and GitHub attestations, then install each artifact on a clean machine. On macOS, verify the documented Open/Open Anyway first-launch flow and confirm the app remains ad-hoc signed after download. Verify onboarding, a review, restart persistence, backup export, and backup restore.
6. Verify an artifact with `gh attestation verify <artifact> --repo neoanki/neo-anki`, then publish the draft.

Native app-store releases are separate from the desktop GitHub release. Complete `docs/mobile-release-checklist.md` on physical devices before publishing either store binary; an automated Expo export alone is not approval.

## Rollback

Do not replace an existing release asset or reuse a version. If a release is bad, unpublish it and ship a higher patch version containing the rollback or fix. Users who already updated need a numerically newer version. Preserve the withdrawn release’s checksums and incident notes for auditability.

Never edit or replace a published artifact. GitHub attestations and checksums intentionally make replacement detectable.
