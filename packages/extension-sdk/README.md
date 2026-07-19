# @neo-anki/extension-sdk

The only public Neo Anki extension contract. Version 2 packages run non-UI logic in bounded workers and UI contributions in sandboxed iframes; effects cross typed, capability-scoped host calls.

```bash
npm install @neo-anki/extension-sdk
npx neo-anki-extension check
npx neo-anki-extension build
```

An extension project contains `manifest.json`, `package.json`, a worker entry, and optional iframe UI entries. The CLI validates schema 2, bundles each entry, signs a deterministic `.neoanki-extension` archive, and rejects every older schema. React is not a peer dependency because iframe UI owns its document and framework choices.

Bundled Neo Anki features are trusted core modules and do not use this installable-package API. See `docs/extension-authoring.md` and `examples/study-pulse-extension` for the complete contract.
