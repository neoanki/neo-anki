# Neo Anki core and extension boundary

Neo Anki keeps the memory engine and data-safety envelope small. Everything else is an extension contribution. “Bundled” describes how an extension is distributed; it does not grant a stronger API, hidden capability, or privileged host access.

## Kernel

The kernel owns only capabilities whose failure could make the baseline capture → schedule → review loop unsafe or unavailable:

- Canonical knowledge items, practice cards, immutable review events, media assets, settings, and migrations.
- FSRS scheduling and the atomic review transaction.
- The daily time envelope, forecast, deterministic session composer, and the baseline at-risk queue order.
- Basic question → answer creation and rendering, including the fallback renderer for unknown prompt types.
- Transactional local persistence, verified media, rotating recovery backups, native restore/export, and deterministic data merge.
- The Today, Library, Create, and Review surfaces plus extension hosts and Settings.
- The public extension registry: SDK-version validation, permission checks, collision detection, bounded transactions, diagnostics, and failure fallbacks.
- The publisher-neutral capability host: declared-domain HTTPS, OS-encrypted extension secrets, request limits, and redirect revalidation.

The kernel deliberately does not know a closed list of prompt IDs, page routes, importer sources, or recovery-policy IDs. Those identifiers are strings registered through the public SDK.

## Extracted extensions

| Extension | Public contributions |
| --- | --- |
| Prompt Types | Reverse, cloze, typed-answer, and audio prompt renderers; typed-answer comparison |
| Image Occlusion | Prompt renderer, card generation, image authoring panel, mask geometry |
| Interoperability | Anki package importer, CSV importer, CSV exporter |
| Recovery Policies | Oldest-overdue and quick-wins queue policies |
| Goals & Saved Views | Planning signals, transactional commands, workspace panels |
| Shared Packs | Pack install/update/conflict commands and workspace panel |
| Insights | An extension-contributed application page |
| Browser Tab Sync | A BroadcastChannel sync transport |
| Card Timer | Settings panel and review-session tool; disabled by default, with timeout submitted through the core review transaction |

Their source lives under `src/extensions/`. Previous `src/lib/*` and `src/pages/InsightsPage.tsx` paths are compatibility re-exports only; the app itself consumes the registry.

## One SDK, no publisher tiers

Every extension supplies the same `NeoAnkiExtension` object and goes through `ExtensionRegistry.register`. Registration decisions use manifest version, declared permissions, and contribution IDs—not publisher identity. Bundled extensions do not import the private application context; contributed pages and panels receive public, read-only host props and write through the same command API.

Bundled extensions are registered at application startup. User-approved local `.neoanki-extension` packages are validated, installed atomically, served from a dedicated desktop protocol, loaded as browser modules, and passed to the same registry. “Bundled” and “local package” are distribution labels only. SDK v1 uses a full-trust code model for both: permissions constrain registry contributions but are not a hostile-code sandbox.

See [extension-sdk.md](extension-sdk.md) for the contract and an independently published example.

## Enforced invariants

- Unknown or crashing prompt renderers fall back to the basic renderer, so cards remain reviewable.
- Contribution failures are isolated and recorded as diagnostics.
- A startup watchdog automatically opens a fresh window without local packages if extension evaluation blocks renderer readiness.
- Duplicate contribution IDs are rejected before startup completes.
- Planning-signal strength is clamped to a bounded range; non-finite policy scores are ignored.
- Commands receive a cloned snapshot and have no effect unless they submit a replacement transaction.
- Settings and Review contributions are isolated behind host error boundaries; both receive read-only snapshots and the same host API, while review ratings reject duplicate or stale submissions.
- Command transactions cannot rewrite the append-only review log, device identity, scheduler settings, or schema version.
- Pack operations preserve scheduling state; conflicting content edits remain explicit.
- Session duration, focus, and presentation order never mutate due dates or review history.
- Interleaving happens within coherent contexts; unrelated contexts switch at block boundaries.

## Still postponed

- Extension-package signatures, verified publisher identity, marketplace discovery, extension automatic updates, and dependency resolution.
- AI extraction, generation, rewriting, and grading.
- OCR, PDF pipelines, web clipping, and external knowledge connectors.
- Code execution, handwriting, drawing, maps, pronunciation scoring, and richer specialized practice widgets.
- Alternative schedulers. Queue ordering can be extended now; replacing memory-state transitions requires a migration and rollback design.
- Hosted sync/account providers, collaboration, marketplaces, themes, and decorative gamification.
