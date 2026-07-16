# Neo Anki core and extension boundary

The core is intentionally small, but not minimal at the cost of data safety. A capability belongs in core when at least one of these is true:

1. Its absence could strand, corrupt, or silently rewrite user data.
2. It participates in deterministic scheduling or queue selection.
3. Every client must render it consistently for a collection to remain portable.
4. It is required for the baseline capture → author → review workflow.
5. It enforces security, accessibility, or conflict-resolution invariants that extensions cannot be trusted to reproduce.

## Core through Phase 2

- Canonical schemas for knowledge items, prompts, review events, citations, media, goals, saved views, and pack provenance.
- FSRS scheduling and the time-budget planner.
- Basic, reverse, cloze, typed-answer, media, and image-occlusion rendering.
- Visual authoring for those durable prompt primitives.
- Search, saved views, learning goals, and backlog rescue.
- Anki, CSV, Neo backup, pack, and patch import/export formats.
- Offline app shell, local persistence, deterministic merge, and sync-provider interface.
- Pack installation, three-way updates, conflict resolution, and preservation of personal scheduling history.
- Keyboard, touch, screen-reader, and reduced-motion behavior.

## Core mechanism with extension implementations

| Core contract | Extension territory |
| --- | --- |
| Deterministic merge protocol | Hosted sync transports and account providers |
| Pack manifest, patches, provenance, and conflicts | Signatures, marketplaces, catalogs, ratings, and discovery |
| Media storage and playback | TTS, pronunciation, transcription, and media generation |
| Import/export transaction API | Notion, Obsidian, LMS, proprietary database, and niche format connectors |
| Prompt renderer/editor contribution points | Domain-specific editors and practice widgets |
| Health finding schema | AI diagnosis and domain-specific lint rule packs |

## Postponed to extensions

- AI extraction, generation, rewriting, and grading.
- OCR, PDF pipelines, web clipping, and external knowledge connectors.
- Multiple choice, code execution, handwriting, drawing, maps, pronunciation scoring, and other specialized prompt types.
- Alternative schedulers and experimental scheduling policies.
- Advanced analytics beyond recall calibration, workload, and repair signals.
- Social feeds, collaboration presence, public profiles, and marketplace UX.
- Themes, decorative gamification, and custom study modes.

## Invariants

- Extensions cannot mutate review history directly.
- Scheduler changes are explicit migrations with previews and rollback.
- Pack updates never overwrite personal scheduling state.
- Conflicting content edits are preserved until resolved.
- Every extension-owned datum is namespaced and exportable.
- Collections remain fully reviewable, searchable, and exportable with all extensions disabled.
