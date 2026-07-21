# Install Neo Anki on macOS

Neo Anki's macOS release artifacts are currently unsigned and not notarized. Developer ID signing and notarization are optional future improvements, not release or CI requirements.

1. Open the [latest release](https://github.com/neoanki/neo-anki/releases/latest) and download the macOS DMG.
2. Open the DMG and drag Neo Anki to Applications.
3. Control-click Neo Anki, choose **Open**, then confirm **Open** when macOS shows the unidentified-developer warning.

Neo Anki stores its desktop workspace under `~/Library/Application Support/Neo Anki/` and keeps automatic recovery backups beside it. Installing a newer release preserves that directory; removing the application does not erase it.

On first launch, choose **Start fresh** for an empty workspace or restore a Neo Anki backup. Anki import is available afterward from Today and the Extensions screen.

## Optional advanced verification

Download `SHA256SUMS-macos-universal.txt` from the same release. Run `shasum -a 256 "Neo-Anki-…dmg"` and compare the result with the matching checksum line. For provenance verification, run `gh attestation verify <artifact> --repo neoanki/neo-anki`.

Do not continue if either the checksum or GitHub attestation fails.
