# Neo Anki

A TypeScript-first, local-first spaced-repetition app that plans learning around a daily time budget instead of a fixed new-card quota.

## Phase 1–2 feature set

- FSRS scheduling with a forecast-aware time planner and risk, oldest-first, or momentum backlog rescue.
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

FSRS owns memory state and future due dates. The planner learns review pace, reserves today’s time for due knowledge, forecasts reinforcement cost, and introduces only the new prompts that fit both today and the seven-day outlook. If due work exceeds the budget, new material stops and the selected rescue strategy determines the queue. Goals add a bounded urgency signal without bypassing these safety constraints.
