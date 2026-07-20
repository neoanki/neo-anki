# Install Neo Anki on Windows

Neo Anki's Windows release artifacts are currently unsigned. Authenticode signing is an optional future improvement, not a release or CI requirement.

1. Download the EXE and `SHA256SUMS-windows-x64.txt` from the same GitHub Release.
2. In PowerShell, run `Get-FileHash "Neo-Anki-…exe" -Algorithm SHA256` and compare it with the matching checksum line.
3. For stronger provenance verification, run `gh attestation verify <artifact> --repo neoanki/neo-anki`.
4. Start the installer. Windows may show an unknown-publisher warning; continue only after the checksum and GitHub attestation both pass.

Updates are manual. Download and verify every new installer before running it.
