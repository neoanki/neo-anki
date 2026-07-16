# Neo Anki

A TypeScript-first, local-first desktop spaced-repetition app that plans learning around a daily time budget instead of a fixed new-card quota.

## MVP feature set

- FSRS scheduling with a forecast-aware daily target, any-size practice sessions, and risk, oldest-first, or momentum backlog rescue.
- Adaptive session composition: a balanced mix, one-area focus, or urgent reviews, sequenced as coherent context blocks instead of random category switching.
- Basic, reverse, cloze, typed-answer, image-occlusion, and audio prompts over a canonical knowledge model.
- Visual authoring with media, multiple citations, duplicate detection, and actionable prompt-health diagnostics.
- Today, focused Review, searchable Library, Goals, Saved Views, Shared Packs, and Insights.
- Learning goals feed urgency into the daily planner rather than becoming a separate task list.
- Current and legacy Anki `.apkg`/`.colpkg` import (SQLite, zstd, protobuf media maps), plus CSV and Neo Anki JSON; JSON/CSV export and complete backups.
- Patch-based shared packs with three-way merging, explicit conflict resolution, and preserved review history.
- Electron desktop application with integrated macOS window chrome, native menus and shortcuts, a plain study queue and card browser, atomic filesystem persistence, a rolling recovery copy, native backup export, and light/dark themes.
- A TypeScript extension SDK with uniform permissions and APIs for every publisher. Prompt types, image occlusion, Anki/CSV interoperability, recovery policies, goals and views, shared packs, Insights, and tab sync are registered extensions rather than kernel features.

The implemented boundary is documented in [docs/core-and-extensions.md](docs/core-and-extensions.md); extension authors can start with [docs/extension-sdk.md](docs/extension-sdk.md).

## Run the desktop app

```bash
npm install
npm run desktop:dev
```

The renderer is sandboxed and has no Node.js access. A narrow preload bridge handles persistence in the operating system's application-data directory. On macOS the primary file is normally `~/Library/Application Support/Neo Anki/neo-anki-data.json`; its previous good version is kept beside it as `neo-anki-data.recovery.json`.

Build an installable macOS DMG and ZIP with:

```bash
npm run desktop:build
```

Artifacts are written to `release/`. Local builds are intentionally unsigned until release signing and notarization are configured.

The Vite browser surface remains available through `npm run dev` for component development and automated browser testing. It is not the primary application or durable storage target.

## Quality gates

```bash
npm run test:all
```

This runs ESLint with accessibility rules, TypeScript for renderer and Electron processes, unit/integration/component tests with enforced coverage, the production renderer build, browser accessibility/offline tests, and an Electron restart-persistence test. Install Chromium once with `npx playwright install chromium` if needed.

Current domain coverage thresholds are 80% statements, functions, and lines, and 70% branches. The suite also constructs and imports a real SQLite-backed Anki package.

## Planning model

FSRS owns memory state and future due dates. The planner learns review pace, subtracts practice already completed today, reserves the remaining daily target for due knowledge, forecasts reinforcement cost, and introduces only the new prompts that fit both today and the seven-day outlook. A user can spend that target in one session or several quick sessions.

The session composer is a separate deterministic layer. It can continue today’s mix, focus on one collection, or select urgent reviews only. Unrelated collections stay in short, coherent blocks; cards within a block remain interleaved while sibling prompts are kept apart. Switching context never changes a due date, and ending early leaves the rest of the plan intact.
