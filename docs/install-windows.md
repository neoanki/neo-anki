# Install Neo Anki on Windows

Neo Anki's Windows installer is intentionally unsigned. Windows SmartScreen may show “Windows protected your PC.”

1. Download the EXE and `SHA256SUMS-windows-x64.txt` from the same GitHub Release.
2. In PowerShell, run `Get-FileHash "Neo-Anki-…exe" -Algorithm SHA256` and compare it with the matching checksum line.
3. Start the installer. If SmartScreen appears, choose **More info**, confirm the publisher is shown as unknown, and choose **Run anyway**.

Updates are manual. Download and verify every new installer before running it. For stronger provenance verification, use `gh attestation verify <artifact> --repo neoanki/neo-anki`.
