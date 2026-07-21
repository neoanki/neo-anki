# Install Neo Anki on macOS

Neo Anki's supported macOS release artifacts are Developer ID signed and notarized. macOS should open them without an unidentified-developer or malware-verification override.

Version 0.4.2 and older macOS artifacts are legacy unsigned builds and do not satisfy this policy. Wait for a newer signed release instead of bypassing Gatekeeper.

1. Open the [latest release](https://github.com/neoanki/neo-anki/releases/latest) and download the macOS DMG.
2. Open the DMG and drag Neo Anki to Applications.
3. Open Neo Anki from Applications.

If macOS says it cannot verify Neo Anki, stop. That artifact does not satisfy the current release policy; do not bypass Gatekeeper. Report the version and filename on the issue tracker and use a newer signed release when available.

Neo Anki stores its desktop workspace under `~/Library/Application Support/Neo Anki/` and keeps automatic recovery backups beside it. Installing a newer release preserves that directory; removing the application does not erase it.

On first launch, choose **Start fresh** for an empty workspace or restore a Neo Anki backup. Anki import is available afterward from Today and the Extensions screen.

## Optional advanced verification

Download `SHA256SUMS-macos-universal.txt` from the same release. Run `shasum -a 256 "Neo-Anki-…dmg"` and compare the result with the matching checksum line. For provenance verification, run `gh attestation verify <artifact> --repo neoanki/neo-anki`.

Do not continue if either the checksum or GitHub attestation fails.
