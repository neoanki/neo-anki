# Neo Anki

A TypeScript-first, local-first spaced-repetition app that plans learning around a daily time budget instead of a fixed new-card quota.

## Phase 1–2 feature set

- FSRS scheduling with a forecast-aware daily target, any-size practice sessions, and risk, oldest-first, or momentum backlog rescue.
- Adaptive session composition: a balanced mix, one-area focus, or urgent reviews, sequenced as coherent context blocks instead of random category switching.
- Basic, reverse, cloze, typed-answer, image-occlusion, and audio prompts over a canonical knowledge model.
- Visual authoring with media, multiple citations, duplicate detection, and actionable prompt-health diagnostics.
- Today, focused Review, searchable Library, Goals, Saved Views, Shared Packs, and Insights.
- Learning goals feed urgency into the daily planner rather than becoming a separate task list.
- Current and legacy Anki `.apkg`/`.colpkg` import (SQLite, zstd, protobuf media maps), plus CSV and Neo Anki JSON; JSON/CSV export and complete backups.
- Patch-based shared packs with three-way merging, explicit conflict resolution, and preserved review history.
- Local persistence, deterministic cross-tab merge, installable PWA shell, offline reload, keyboard navigation, responsive layouts, and light/dark themes.

The core/extension boundary and postponed features are documented in [docs/core-and-extensions.md](docs/core-and-extensions.md).

## Run

```bash
npm install
npm run dev
```

## Quality gates

```bash
npm run test:all
```

This runs ESLint with accessibility rules, TypeScript, unit/integration/component tests with enforced coverage, a production build, and Playwright desktop/mobile/accessibility/offline tests. Install the browser once with `npx playwright install chromium` if needed.

Current domain coverage thresholds are 80% statements, functions, and lines, and 70% branches. The suite also constructs and imports a real SQLite-backed Anki package.

## Planning model

FSRS owns memory state and future due dates. The planner learns review pace, subtracts practice already completed today, reserves the remaining daily target for due knowledge, forecasts reinforcement cost, and introduces only the new prompts that fit both today and the seven-day outlook. A user can spend that target in one session or several quick sessions.

The session composer is a separate deterministic layer. It can continue today’s mix, focus on one collection, or select urgent reviews only. Unrelated collections stay in short, coherent blocks; cards within a block remain interleaved while sibling prompts are kept apart. Switching context never changes a due date, and ending early leaves the rest of the plan intact.
