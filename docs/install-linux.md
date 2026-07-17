# Install Neo Anki on Linux

1. Download the AppImage and `SHA256SUMS-linux-x64.txt` from the same GitHub Release.
2. Run `sha256sum "Neo Anki-…AppImage"` and compare it with the matching checksum line.
3. Run `chmod +x "Neo Anki-…AppImage"`, then launch it.

Updates are manual. Download and verify every new AppImage before replacing the previous one. For stronger provenance verification, use `gh attestation verify <artifact> --repo neoanki/neo-anki`.
