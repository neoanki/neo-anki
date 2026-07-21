# @neo-anki/extension-sdk

The only public Neo Anki extension contract. Version 2 packages run non-UI logic in bounded workers and executable UI contributions in sandboxed iframes; effects cross typed, capability-scoped host calls. Extension settings are inert manifest data rendered and persisted by Neo Anki, never iframe code.

```bash
npm install @neo-anki/extension-sdk
npx neo-anki-extension check
npx neo-anki-extension build
```

An extension project contains `manifest.json`, optional worker and iframe UI entries, and an optional declarative settings contribution. The CLI validates schema 2, settings limits and permission matches, bundles executable entries, signs a deterministic `.neoanki-extension` archive, and rejects every older schema. React is not a peer dependency because executable iframe UI owns its document and framework choices while settings UI is host-owned.

First-party and third-party optional features use this same installable-package API. Core retains only workspace, scheduling, review, persistence, recovery, sync, and extension trust/invariant authorities. See `docs/extension-authoring.md` and `examples/study-pulse-extension` for the complete contract.

Sandboxed UI can map host appearance values to stable `--neo-*` variables with `applySandboxedUiAppearanceV1`. Filled primary controls must pair `--neo-primary` with `--neo-on-primary`; white is not legible on the light primary fill used by dark themes. UI height is measured from intrinsic body content so the host page can grow and shrink without an inner frame scrollbar.
