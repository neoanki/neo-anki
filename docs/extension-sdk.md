# Neo Anki extension SDK v1

The TypeScript contract is exported from `src/extensions/sdk.ts`; registration and failure isolation live in `src/extensions/registry.ts`.

## Manifest and registration

```ts
import type { NeoAnkiExtension } from './extensions/sdk'
import { ExtensionRegistry } from './extensions/registry'

export const diagramPrompts: NeoAnkiExtension = {
  manifest: {
    id: 'com.example.diagram-prompts',
    name: 'Diagram Prompts',
    version: '1.0.0',
    sdkVersion: 1,
    publisher: 'Example Studio',
    permissions: ['prompts:contribute'],
  },
  promptTypes: [{
    id: 'diagram-label',
    label: 'Diagram label',
    createCards: () => [{ promptType: 'diagram-label', estimatedSeconds: 18 }],
    render: (item) => ({
      prompt: item.prompt,
      answer: item.answer,
      context: item.context,
      typed: false,
      citations: item.citations,
    }),
  }],
}

const runtime = new ExtensionRegistry()
runtime.register(diagramPrompts)
```

Changing `publisher` to `Neo Anki contributors` does not alter registration or capabilities.

## Contribution permissions

| Permission | Contribution |
| --- | --- |
| `prompts:contribute` | Prompt creation, rendering, optional answer comparison |
| `imports:files` | File importers selected by extension suffix |
| `exports:files` | File exporters surfaced in Settings |
| `planning:signals` | Bounded item-priority signals |
| `planning:policies` | Recovery queue scoring policies |
| `sync:transport` | A synchronization transport |
| `content:transactions` | Named commands that propose content transactions |
| `ui:pages` | Navigable application pages |
| `ui:workspace-panels` | Panels in the workspace extension host |
| `ui:create-panels` | Authoring panels in Create |
| `ui:library-presets` | Named query and collection presets in Library |

Registering a non-empty contribution without its permission throws. IDs are global within a contribution kind, and collisions throw.

## Data and transaction rules

Page and panel contributions receive `data`, `plan`, and `runCommand` as public props. Data is read-only by contract. Commands receive a cloned snapshot and must call `replaceData` to propose a change. The registry preserves review history, scheduler settings, device identity, and schema version even if a command includes replacements for them.

This boundary is deterministic failure containment for in-process TypeScript extensions; it is not an operating-system security sandbox. Loading untrusted downloaded code is outside SDK v1 and remains disabled.

## Degradation behavior

- Missing or failing prompt renderer: render the item as a basic question and answer.
- Failing answer comparator: fall back to manual grading.
- Failing planning signal: omit that provider’s signals.
- Invalid or failing queue policy: fall back to kernel ordering.
- Failing sync transport creation: remain local-only.
- Failing import or command: report the error and leave the existing data unchanged.

Diagnostics are available through `ExtensionRegistry.getDiagnostics()` and are summarized in Settings.
