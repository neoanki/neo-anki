# Install Neo Anki on macOS

Neo Anki's current macOS release artifacts are ad-hoc signed and verified by CI, but are not yet Developer ID signed or Apple notarized. The signature protects the packaged code from unnoticed modification after signing; it does not establish Neo Anki as an Apple-verified publisher. Verify the release checksum and GitHub provenance attestation before approving the app.

Version 0.4.2 and older macOS artifacts are legacy unsigned builds. Prefer a newer ad-hoc signed release.

1. Open the [latest release](https://github.com/neoanki/neo-anki/releases/latest) and download the macOS DMG.
2. Open the DMG and drag Neo Anki to Applications.
3. Control-click Neo Anki in Applications, choose **Open**, then choose **Open** in the confirmation dialog. If macOS offers only a blocked message, open **System Settings → Privacy & Security**, confirm the app name, and choose **Open Anyway**.

This one-time warning is expected for the interim ad-hoc signed release. Do not use shell commands that remove quarantine metadata. Stop if the checksum, attestation, filename, or displayed app name differs from the release page.

Neo Anki stores its desktop workspace under `~/Library/Application Support/Neo Anki/` and keeps automatic recovery backups beside it. Installing a newer release preserves that directory; removing the application does not erase it.

On first launch, choose **Start fresh** for an empty workspace or restore a Neo Anki backup. Anki import is available afterward from Today and the Extensions screen.

## Optional advanced verification

Download `SHA256SUMS-macos-universal.txt` from the same release. Run `shasum -a 256 "Neo-Anki-…dmg"` and compare the result with the matching checksum line. For provenance verification, run `gh attestation verify <artifact> --repo neoanki/neo-anki`.

Do not continue if either the checksum or GitHub attestation fails.
