# Install Neo Anki on Linux

1. Open the [latest release](https://github.com/neoanki/neo-anki/releases/latest) and download the Linux AppImage.
2. Run `chmod +x "Neo-Anki-…AppImage"`, then launch it.

Neo Anki stores its workspace in your user application-data directory. Replacing or deleting the AppImage does not delete the workspace.

On first launch, choose **Start fresh** for an empty workspace or restore a Neo Anki backup. Anki import is available afterward from Today and the Extensions screen.

## Optional advanced verification

Download `SHA256SUMS-linux-x64.txt` from the same release. Run `sha256sum "Neo-Anki-…AppImage"` and compare it with the matching checksum line. For provenance verification, use `gh attestation verify <artifact> --repo neoanki/neo-anki`.

Updates are manual. Download and verify every new AppImage before replacing the previous one.
