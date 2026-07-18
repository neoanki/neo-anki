# Install Neo Anki on macOS

Tagged Neo Anki releases require Developer ID signing and Apple notarization. Local developer builds are not release artifacts and may be unsigned.

1. Download the DMG and `SHA256SUMS-macos-universal.txt` from the same GitHub Release.
2. In Terminal, run `shasum -a 256 "Neo-Anki-…dmg"` and compare the result with the matching line in the checksum file.
3. Open the DMG and drag Neo Anki to Applications.
4. Open Neo Anki normally. A tagged release must pass Gatekeeper without **Open Anyway** or an unidentified-developer warning.
5. If macOS reports that the developer cannot be verified, do not bypass the warning. Verify the download and report the release artifact.

For stronger provenance verification, use `gh attestation verify <artifact> --repo neoanki/neo-anki`.
