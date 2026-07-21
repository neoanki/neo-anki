# Neo Anki extension SDK 2

`@neo-anki/extension-sdk` 2.x is the only public contract for installable extensions. It separates non-UI logic from UI and gives neither direct renderer access nor a whole-workspace snapshot. Schema or SDK versions other than 2 are rejected before staging; there is no legacy compatibility runtime.

For a complete signed project, see [extension-authoring.md](extension-authoring.md) and [`examples/study-pulse-extension`](../examples/study-pulse-extension).

## Package manifest

```json
{
  "format": "neo-anki-extension",
  "schemaVersion": 2,
  "sdkVersion": 2,
  "id": "com.example.study-signals",
  "name": "Study Signals",
  "version": "2.0.0",
  "publisher": "Example Studio",
  "publisherKey": "<base64 Ed25519 SPKI public key>",
  "permissions": ["study:signals", "ui:page"],
  "workerEntry": "dist/worker.js",
  "uiEntries": [{ "id": "dashboard", "surface": "page", "entry": "dist/dashboard.js" }],
  "provenance": {
    "sourceCommit": "<40-character commit SHA>",
    "coreCommit": "<40-character reviewed Neo Anki/SDK SHA>",
    "buildSystem": "neo-anki-extension-cli"
  }
}
```

The package builder uses canonical file ordering and fixed archive timestamps, then signs the canonical unsigned package digest. Desktop verifies the signature and manifest publisher key before staging installation.

## Worker contract

Non-UI contributions export a v2 extension and expose it through the worker bootstrap:

```ts
import { defineExtension, exposeExtensionWorker } from '@neo-anki/extension-sdk'

const extension = defineExtension({
  manifest,
  async handle(request, host) {
    if (request.type !== 'planning-signals') {
      return { type: 'error', requestId: request.type === 'command' ? request.requestId : request.operationId, code: 'unsupported', message: 'Unsupported request.' }
    }
    return {
      type: 'planning-signals',
      requestId: request.request.requestId,
      signals: request.request.items.map((item) => ({ itemId: item.noteId, score: 0, reason: 'No adjustment' })),
    }
  },
})

exposeExtensionWorker(extension)
```

The worker receives bounded request DTOs. It has no ambient renderer DOM, workspace, cookies, IndexedDB or unrestricted network. Useful effects go through `ExtensionHostV2` RPC and are permission-checked again by core.

## Declarative settings contract

`manifest.settings` is inert data rendered by Neo Anki under **Extensions → Configure**. It is not an iframe or UI entry, does not execute extension code, and has no action/command callback. Settings may only describe synchronized configuration and device-local credentials.

```json
{
  "permissions": ["config:sync", "secrets:device"],
  "settings": {
    "schemaVersion": 1,
    "label": "Study Signals",
    "sections": [{
      "id": "general",
      "title": "General",
      "controls": [
        { "id": "enabled", "kind": "toggle", "path": "/enabled", "label": "Enable Study Signals", "defaultValue": true },
        { "id": "threshold", "kind": "number", "path": "/threshold", "label": "Threshold", "min": 1, "max": 100, "requiredWhen": { "path": "/enabled", "operator": "truthy" } },
        { "id": "token", "kind": "secret", "secretKey": "provider.token", "label": "Provider token" }
      ]
    }]
  }
}
```

Controls are `toggle`, `text`, `textarea`, `number`, `range`, `select`, `string-list`, `notice`, `secret`, and repeatable `group`. Groups may nest two levels. Stored controls use safe JSON Pointer paths; group field paths are relative to the current item. Static conditions support visibility, enabling, required-when, equality/inequality, inclusion, truthiness, and numeric comparisons. Neo Anki applies defaults only to missing declared paths, preserves undeclared config keys, validates locally, and atomically writes the complete synchronized draft only after explicit Save.

Secret controls require static keys. The host reports only Configured/Not configured, and Set/Replace/Delete use the device secret broker; existing plaintext is never loaded into the renderer or synchronized config. Synchronized controls require `config:sync`; secret controls require `secrets:device`. The settings contribution itself needs no UI permission.

Settings cannot declare actions, worker validation, dynamic options, commands, network requests, polling, progress, tests, generation, or arbitrary callbacks. Put imports on a migration surface and executable maintenance/generation/provider workflows on page, workspace, review, or create surfaces. Schemas are capped at 128 controls, 100 static select options, two repeatable-group levels, the 64 KiB manifest limit, and the 256 KiB synchronized-config limit.

## Sandboxed executable UI contract

Review, page, create, workspace, and migration contributions run in separate opaque-origin iframes. Use `createSandboxedUiClient()` to receive the initialization DTO and invoke the paired worker through the host:

```ts
import { createSandboxedUiClient } from '@neo-anki/extension-sdk'

void createSandboxedUiClient().then(async (client) => {
  const summary = client.init.dto
  const result = await client.call('command', { commandId: 'refresh', payload: {} })
  // Render only into this iframe's document.
})
```

The frame has `sandbox="allow-scripts"` without `allow-same-origin`, an explicit no-network CSP and a transferred `MessagePort`. It cannot inspect or style the Neo Anki document. UI authors must implement semantic HTML, visible focus, keyboard operation, 16 px default text, AA contrast, reduced-motion behavior and responsive layout inside their frame.

Call `applySandboxedUiAppearanceV1(client.init.appearance)` or use the variables it installs when styling the frame. In particular, use `--neo-on-primary` for text and icons placed on a `--neo-primary` background; dark themes intentionally use a light primary fill with a dark foreground. Frame height is reported from intrinsic body content so an embedded surface can grow and shrink without adding an inner scrollbar.

## Permissions and host methods

| Permission | Reviewed capability |
| --- | --- |
| `study:read` | Minimal study projections for the declared contribution |
| `study:signals` | Bounded planning-signal requests/responses |
| `study:prompt-types` | Manifest-declared prompt creation, rendering, and typed comparison DTOs |
| `study:queue-policies` | Manifest-declared bounded queue-scoring requests |
| `content:read` | Paginated, scoped note DTOs through `content.listNotes` |
| `content:patch-own` | Owner-scoped, revision-checked `WorkspacePatchV2` changes |
| `content:migrate` | Local Workspace v4 export plus checkpointed, core-validated migration commit |
| `media:create` | Core-owned media decoding, hashing and atomic creation |
| `network:fetch` | Cancellable, bounded HTTPS requests to reviewed destinations |
| `secrets:device` | Atomic device-local secret reads/mutations in the extension namespace |
| `config:sync` | Bounded non-secret extension configuration synchronized as Workspace v4 data |
| `ui:review` | A reviewed sandboxed Review entry |
| `ui:page` | A reviewed sandboxed application page |
| `ui:create` | A reviewed sandboxed authoring entry |
| `ui:workspace` | A reviewed sandboxed planning/sharing entry |
| `ui:migration` | A reviewed sandboxed migration entry |

`ExtensionHostV2` exposes `applyPatch`, `createMedia`, `fetch`, `cancel`, atomic `secrets` methods, synchronized `config` methods, paginated `content.listNotes`, and the high-authority migration broker. The host rejects calls whose permission, owner, operation ID, destination, size or current workspace revision does not match the reviewed contract. Migration commits create a recovery checkpoint and revalidate the complete Workspace v4 document in core.

## Resource and failure boundaries

- Ordinary worker/UI messages are bounded; binary-aware accounting permits the reviewed 512 MiB migration envelope without JSON-expanding `File`, `Blob`, or typed-array payloads.
- A worker may have at most 100 pending requests.
- Startup is bounded to 5 seconds; ordinary work defaults to 15 seconds and is capped at 180 seconds.
- Planning DTOs are chunked to 2,000 items and malformed/non-finite signals are rejected.
- Network responses are streamed and aborted at the reviewed cap; redirects are revalidated and cross-host authorization headers are removed.
- Patch and media operations are atomic and invariant-checked by core.
- Closing or timing out a worker cancels pending host work and rejects callers.
- A failing frame or worker can be removed without sharing failure state with the main React tree.

## Compatibility and trust

SDK 2 schema or protocol changes require an intentional application-and-extension migration before release. Package signatures authenticate a key, not a human organization. Users still review the publisher label, public key fingerprint, permissions, network destinations, provenance, version and downgrade status before install. Marketplace discovery adds public review history, immutable release/hash pinning and publisher-key continuity; verified real-world publisher identity, automatic updates and dependency resolution are not currently claimed.
