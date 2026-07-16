# Authoring and distributing a Neo Anki extension

## 1. Create the project

An extension contains:

```text
my-extension/
├── manifest.json
├── package.json
├── README.md
└── src/
    └── index.tsx
```

Install the SDK and React:

```bash
npm install @neo-anki/extension-sdk react
npm install --save-dev @types/react
```

Add scripts and the source entry to `package.json`:

```json
{
  "type": "module",
  "neoAnki": { "entry": "src/index.tsx" },
  "scripts": {
    "check": "neo-anki-extension check",
    "build": "neo-anki-extension build"
  }
}
```

## 2. Declare the reviewed package manifest

```json
{
  "format": "neo-anki-extension",
  "schemaVersion": 1,
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "sdkVersion": 1,
  "publisher": "Example Studio",
  "description": "What this extension contributes.",
  "homepage": "https://example.com/my-extension",
  "permissions": ["ui:pages"],
  "entry": "dist/index.js"
}
```

IDs use lowercase reverse-domain notation. Versions use semantic versioning. The package manifest is shown before installation; the runtime extension must match its ID, version, SDK version, publisher, and permissions.

## 3. Implement the default export

Use `defineExtension` for inference and compatibility checking. React UI contributions may use normal hooks and the SDK’s stable UI primitives. Do not import Neo Anki source files or private application context.

Run:

```bash
npm run check
npm run build
```

The CLI bundles browser code, connects React imports to the host runtime, validates package paths and limits, and writes `build/<id>-<version>.neoanki-extension`.

## 4. Test installation and upgrades

In the desktop app, open Settings → Extensions → Install from file. Neo Anki shows:

- publisher and version;
- requested and newly added capabilities;
- package size;
- a SHA-256 fingerprint;
- downgrade and trust warnings.

Install, reload, exercise every contribution, then verify disable, re-enable, update, downgrade, fallback behavior, and uninstall. Unknown prompt types must remain understandable with the basic renderer.

For automated desktop testing, Neo Anki accepts an explicit command-line package:

```bash
Neo\ Anki --install-extension=/absolute/path/example.neoanki-extension
```

## Package limits

- Maximum compressed size: 5 MB.
- Maximum expanded size: 15 MB.
- Maximum files: 128.
- Paths must be relative, normalized, and traversal-free.
- Entry must be a packaged `.js` or `.mjs` module.
- SDK and package schema must both be supported.

Updates are installed into a new fingerprinted version directory. The active registry pointer changes atomically; the previous package is removed only after the new state is durable.

## Trust model

Local extensions execute as JavaScript in Neo Anki’s sandboxed renderer. They have no Node.js integration, and the application Content Security Policy blocks arbitrary remote scripts and connections. However, contribution permissions describe intended SDK use; they are not a hostile-code security sandbox. An extension can render UI and receives data required by its declared contributions. Install only packages whose publisher and source you trust.

Neo Anki does not currently claim package signatures, publisher verification, a marketplace, automatic updates, or dependency resolution. SHA-256 fingerprints provide integrity identification, not authorship.
