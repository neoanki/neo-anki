# Install Neo Anki on macOS

Neo Anki community builds are intentionally unsigned and not notarized. macOS will therefore require one explicit security override on first launch.

1. Download the DMG and `SHA256SUMS-macos-universal.txt` from the same GitHub Release.
2. In Terminal, run `shasum -a 256 "Neo-Anki-…dmg"` and compare the result with the matching line in the checksum file.
3. Open the DMG and drag Neo Anki to Applications.
4. Try to open Neo Anki once. macOS will block the unidentified developer.
5. Open **System Settings → Privacy & Security**, scroll to Security, choose **Open Anyway**, then confirm **Open**.

The exception applies to that installed build. Repeat the verification and override after manually installing a newer release. For stronger provenance verification, use `gh attestation verify <artifact> --repo neoanki/neo-anki`.
