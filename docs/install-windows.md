# Install Neo Anki on Windows

Neo Anki's Windows release artifacts are currently unsigned. Authenticode signing is an optional future improvement, not a release or CI requirement.

1. Open the [latest release](https://github.com/neoanki/neo-anki/releases/latest) and download the Windows EXE.
2. Start the installer. Windows may show an unknown-publisher warning; continue only if you downloaded it from the official release page.

Neo Anki stores its workspace in the current user's application-data directory. Upgrading or uninstalling the application does not delete that workspace unless you explicitly erase it in Neo Anki.

On first launch, choose **Start fresh** for an empty workspace or restore a Neo Anki backup. Anki import is available afterward from Today and the Extensions screen.

## Optional advanced verification

Download `SHA256SUMS-windows-x64.txt` from the same release. In PowerShell, run `Get-FileHash "Neo-Anki-…exe" -Algorithm SHA256` and compare it with the matching checksum line. For provenance verification, run `gh attestation verify <artifact> --repo neoanki/neo-anki`.

Updates are manual. Download and verify every new installer before running it.
