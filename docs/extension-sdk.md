# Neo Anki extension SDK v1

`@neo-anki/extension-sdk` is the only public contract for bundled and independently distributed extensions. Publisher identity never changes registration, permissions, host props, failure isolation, or transaction rules.

For a complete extension project, see [extension-authoring.md](extension-authoring.md) and [`examples/study-pulse-extension`](../examples/study-pulse-extension).

## Runtime contract

```ts
import { defineExtension } from '@neo-anki/extension-sdk'

export default defineExtension({
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
})
```

The default export is the same `NeoAnkiExtension` object passed to `ExtensionRegistry.register` for bundled extensions.

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
| `ui:pages` | Navigable React application pages |
| `ui:workspace-panels` | React panels in the workspace extension host |
| `ui:create-panels` | React authoring panels in Create |
| `ui:library-presets` | Named query and collection presets in Library |
| `ui:settings-panels` | React controls hosted in Settings |
| `review:tools` | React review-session tools that can observe the current card and submit a core rating |

Non-empty contributions without their declared permission are rejected. Contribution IDs are global within their kind and collisions are rejected. These declarations constrain SDK registration; SDK v1 extensions are explicitly installed full-trust code, so permissions are not a hostile-code sandbox.

## UI host

The package exports stable `ExtensionPage`, `ExtensionHeader`, `ExtensionMetricGrid`, `ExtensionMetric`, `ExtensionSection`, and `ExtensionNotice` components. The build CLI links `react`, `react/jsx-runtime`, and `react/jsx-dev-runtime` to Neo Anki’s host React instance, so hooks and context use one React runtime.

Contributed pages and panels receive `ExtensionPageProps`:

- `data` — read-only current workspace data.
- `plan` — read-only current time-budget plan.
- `runCommand(id, payload)` — invoke a registered command.
- `extensionId` — the host contribution identifier.

Settings panels receive their `extensionId`. Review tools receive read-only `card` and `item` snapshots, the current `revealed` state, and `submitRating(1 | 2 | 3)`. The host rejects stale or duplicate submissions, then records an accepted rating through the same atomic review transaction used by the standard grading controls. Review and Settings components are isolated behind host error boundaries.

## Transactions and degradation

Commands receive a cloned snapshot and have no effect unless they call `replaceData`. The host preserves review history, scheduler settings, device identity, and schema version even if a command proposes replacements for them.

- Missing or failing prompt renderer → basic question/answer fallback.
- Failing answer comparator → manual grading.
- Failing planning signal → omit that provider’s signals.
- Invalid queue policy → kernel ordering.
- Failing sync transport → local-only operation.
- Failing Settings or Review component → omit that component and record a diagnostic.
- Failing import, command, or module load → diagnostic plus unchanged existing data.
- Extension blocks initial renderer readiness → main-process watchdog opens a fresh safe-mode window without local packages.

## Compatibility

SDK v1 follows semantic versioning. Additive types and optional fields may ship in `1.x`; breaking API or package-format changes require SDK v2. Neo Anki validates `schemaVersion`, `sdkVersion`, manifest identity, permissions, entry paths, archive size, and contribution collisions before activation.
