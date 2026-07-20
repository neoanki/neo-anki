# Install Neo Anki on macOS

Neo Anki's macOS release artifacts are currently unsigned and not notarized. Developer ID signing and notarization are optional future improvements, not release or CI requirements.

1. Download the DMG and `SHA256SUMS-macos-universal.txt` from the same GitHub Release.
2. In Terminal, run `shasum -a 256 "Neo-Anki-…dmg"` and compare the result with the matching line in the checksum file.
3. For stronger provenance verification, run `gh attestation verify <artifact> --repo neoanki/neo-anki`.
4. Open the DMG and drag Neo Anki to Applications.
5. After verifying the checksum and attestation, Control-click Neo Anki, choose **Open**, then confirm **Open** when macOS shows the unidentified-developer warning.

Do not continue if either the checksum or GitHub attestation fails.
