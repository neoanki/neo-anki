# @neo-anki/extension-sdk

Public TypeScript types, `defineExtension`, package validation, and the `neo-anki-extension` build CLI for Neo Anki SDK v1.

```bash
npm install @neo-anki/extension-sdk react
npx neo-anki-extension check
npx neo-anki-extension build
```

An extension project contains `manifest.json`, `package.json`, and `src/index.ts` or `src/index.tsx`. The CLI bundles browser code, links React UI contributions to Neo Anki's host React instance, validates the manifest, and emits a bounded `.neoanki-extension` archive.

See the Neo Anki repository's `docs/extension-authoring.md` and `examples/study-pulse-extension` for the complete contract.
