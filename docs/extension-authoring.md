# Authoring and distributing a Neo Anki SDK 2 extension

All installable extensions use SDK 2. The signed Study Pulse example is the executable reference: [`examples/study-pulse-extension`](../examples/study-pulse-extension).

## 1. Create the project

```text
my-extension/
├── manifest.json
├── package.json
├── README.md
└── src/
    ├── worker.ts       # optional non-UI logic
    └── dashboard.ts    # optional sandboxed UI entry
```

Install `@neo-anki/extension-sdk`. Do not depend on React or import Neo Anki source files: extension UI owns its iframe document, and all host interaction uses the SDK message contract.

```json
{
  "type": "module",
  "neoAnki": {
    "workerEntry": "src/worker.ts",
    "uiEntries": { "dashboard": "src/dashboard.ts" }
  },
  "scripts": {
    "check": "neo-anki-extension check",
    "build": "neo-anki-extension build"
  },
  "dependencies": {
    "@neo-anki/extension-sdk": "2.1.0"
  }
}
```

The `neo-anki-extension` CLI currently ships with the repository package tooling. Pin the SDK and builder versions used for a release.

## 2. Declare the reviewed manifest

Use schema/sdk version 2, reverse-domain lowercase IDs, semantic versions and exact entry paths. Declare only the permissions and HTTPS destinations actually used. `provenance.sourceCommit` must be the complete Git object ID for the audited extension source. Independently released extensions should also record the exact reviewed host/SDK input as `provenance.coreCommit`.

```json
{
  "format": "neo-anki-extension",
  "schemaVersion": 2,
  "sdkVersion": 2,
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "2.0.0",
  "publisher": "Example Studio",
  "publisherKey": "<base64 Ed25519 SPKI public key>",
  "permissions": ["study:signals", "ui:page"],
  "networkDomains": [],
  "workerEntry": "dist/worker.js",
  "uiEntries": [{ "id": "dashboard", "surface": "page", "entry": "dist/dashboard.js" }],
  "provenance": { "sourceCommit": "<40-character SHA>", "coreCommit": "<40-character Neo Anki SHA>", "buildSystem": "neo-anki-extension-cli" }
}
```

The runtime identity is the reviewed manifest; extension code must not invent broader permissions or alternate entries.

## 3. Implement the isolated entries

Use `defineExtension` plus `exposeExtensionWorker` for logic. Keep requests cancellable, give every long operation a unique `operationId`, paginate `content.listNotes`, and commit bounded owner-scoped patches. Never place credentials in synchronized config, source, URLs, diagnostics or workspace content; use `host.secrets` for device-local credentials.

Use `createSandboxedUiClient` for UI. The page receives a minimal initialization DTO and may call only the paired worker command bridge. It cannot reach the parent DOM or network. Render accessible, responsive HTML inside the iframe and treat every DTO as potentially stale until a host command confirms its expected revision.

See [extension-sdk.md](extension-sdk.md) for permissions, limits and failure behavior.

## 4. Sign and build

Generate and protect an Ed25519 private key outside the repository. Put the matching base64 DER/SPKI public key in `manifest.publisherKey`, then provide the private PEM only at build time:

```bash
export NEO_ANKI_EXTENSION_SIGNING_KEY="$(security find-generic-password -w -s com.example.neoanki-signing)"
npm run check
npm run build
```

The environment variable may contain the PEM directly. The example uses a checked-in development key solely so its fixture is reproducible; production publishers must not copy that practice. A local `neoAnki.signingKey` path is supported for development, and the builder verifies that it matches `publisherKey`.

Release automation can stamp immutable checked-out inputs without editing the source manifest by setting `NEO_ANKI_EXTENSION_SOURCE_COMMIT` and `NEO_ANKI_EXTENSION_CORE_COMMIT`. The builder validates both as complete Git object IDs before signing; release automation should parse the finished archive and compare them with `git rev-parse HEAD` for each checkout.

The builder emits `build/<id>-<version>.neoanki-extension` with canonical ordering/fixed timestamps and an Ed25519 signature record. Rebuild from a clean checkout and compare SHA-256 digests before release.

## Submit to the marketplace

Publish the exact signed package as an immutable GitHub Release asset, then open a pull request against [`neoanki/extensions`](https://github.com/neoanki/extensions). Add its source repository, metadata, release URL, SHA-256, publisher key, minimum NeoAnki version, and exact permissions to `catalog.json`. Marketplace CI downloads and inspects the package; maintainers review publisher control, provenance, privacy/network behavior, permission scope, license, UX, and learning claims. The catalog repository's `CONTRIBUTING.md` is the normative submission and approval policy.

Signing-key and source-repository continuity are enforced across ordinary updates. Contact maintainers through a private security report before a legitimate key rotation.

## 5. Review installation and lifecycle

In desktop Settings → Extensions → Install from file, verify:

- publisher, publisher-key fingerprint, provenance commit and version;
- requested/new permissions and every network destination;
- compressed/expanded size and package digest;
- update/downgrade status and rollback implications.

Exercise install, identical reinstall, enable/disable, update, downgrade, cancellation, timeout, crash, restart, safe mode and uninstall. Test missing/failed secret backends and whether uninstall should retain or delete device-local secrets. A package must remain recoverable after injected failure at each activation step.

For automated packaged-host testing:

```bash
Neo\ Anki --install-extension=/absolute/path/example.neoanki-extension
```

## Package limits and trust

- Maximum compressed size: 5 MiB.
- Maximum expanded size: 15 MiB.
- Maximum entries: 128.
- Paths must be normalized, relative and traversal-free.
- Reviewed worker/UI entries must be packaged `.js`/`.mjs` files and match the manifest exactly.
- Every package must contain a valid signature whose public key matches the manifest.

Workers and iframes materially contain third-party code, but isolation is not a reason to install arbitrary packages. A signature proves continuity with a key, not benevolence or verified legal identity. Marketplace discovery is review-gated, but real-world identity attestation, dependency resolution and automatic updates are not currently provided.

Schema/SDK 1 packages are unsupported and rejected. There is no compatibility release or full-trust renderer loading path.
