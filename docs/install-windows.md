# Install Neo Anki on Windows

Tagged Neo Anki releases use Authenticode signing. Do not install a release whose signature is missing or invalid; local developer builds are intentionally unsigned.

1. Download the EXE and `SHA256SUMS-windows-x64.txt` from the same GitHub Release.
2. In PowerShell, run `Get-FileHash "Neo-Anki-…exe" -Algorithm SHA256` and compare it with the matching checksum line.
3. Open Properties → Digital Signatures and verify the signature is valid before starting the installer. Do not bypass an unknown-publisher warning for a tagged release.

Updates are manual. Download and verify every new installer before running it. For stronger provenance verification, use `gh attestation verify <artifact> --repo neoanki/neo-anki`.
