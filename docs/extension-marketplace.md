# Extension marketplace

NeoAnki apps discover extensions from the review-gated [`neoanki/extensions`](https://github.com/neoanki/extensions) repository. Its `main` branch is the approved catalog and the stable application endpoint is `https://raw.githubusercontent.com/neoanki/extensions/main/catalog.json`.

## Approval mechanism

A publisher adds or updates one sorted `catalog.json` entry through a pull request. The repository requires the `validate` check, resolved conversations, and code-owner approval. Merge history is the approval log; removal or correction is another reviewed commit.

Automation downloads the immutable GitHub Release asset and verifies:

- catalog schema, unique extension id, semantic versions, and bounded metadata;
- public GitHub source repository and immutable `.neoanki-extension` release URL;
- package size and exact SHA-256;
- package SDK/manifest id, name, version, publisher, permissions, and publisher key;
- repository identity and signing-key continuity across updates.

Maintainers review publisher control, source/build provenance, permission scope, disclosed network/privacy behavior, licensing, user experience, and pedagogical claims. A listed extension must not imply that catalog review proves safety or learning effectiveness.

## Application trust boundary

Web and mobile fetch and validate the same bounded catalog for discovery. Mobile is browse-only until it has an extension runtime.

Desktop installation stays in the Electron main process. The renderer submits only an approved id and version. The main process re-fetches the catalog, requires the exact current listing, enforces the minimum NeoAnki version, downloads only its immutable GitHub Release asset, caps the response, verifies SHA-256, verifies the existing Ed25519 package signature, and compares signed manifest metadata with the catalog. Only then is the package staged in the existing capability-review screen; the user must still confirm installation.

The marketplace adds auditable discovery and supply-chain pinning. It does not provide real-world identity attestation, automatic updates, dependency resolution, or a warranty.
