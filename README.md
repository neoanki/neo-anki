# Neo Anki

A TypeScript-first, local-first desktop spaced-repetition app that plans learning around a daily time budget instead of a fixed new-card quota.

## MVP feature set

- FSRS scheduling with a forecast-aware daily target, any-size practice sessions, and risk, oldest-first, or momentum backlog rescue.
- Adaptive session composition: a balanced mix, one-area focus, or urgent reviews, sequenced as coherent context blocks instead of random category switching.
- Basic, reverse, cloze, typed-answer, image-occlusion, and audio prompts over a canonical knowledge model.
- Visual authoring with media, multiple citations, duplicate detection, and actionable prompt-health diagnostics.
- Today, focused Review, searchable Library, Goals, Saved Views, Shared Packs, and Insights.
- Learning goals feed urgency into the daily planner rather than becoming a separate task list.
- Preflighted current and legacy Anki `.apkg`/`.colpkg` migration through the Workspace v4 compatibility graph, preserving supported named fields, templates/CSS, scheduling, history, presets, card state, cloze identity and media. Unsupported semantics are reported or refused before commit; see [the compatibility contract](docs/anki-compatibility.md).
- Patch-based shared packs with three-way merging, explicit conflict resolution, and preserved review history.
- Electron desktop application with integrated macOS window chrome, native menus and shortcuts, a plain study queue and card browser, transactional SQLite persistence, verified content-addressed media, automatic recovery backups, native backup restore/export, and light/dark themes.
- Trusted, compiled feature modules for prompt types, image occlusion, Anki/CSV interoperability, recovery policies, goals/views, shared packs, Insights and the optional card timer; these modules are architectural boundaries, not third-party security sandboxes.
- Installable `.neoanki-extension` packages use SDK 2 exclusively, with signed reproducible archives, permission review, recoverable lifecycle, provenance and a working example. Logic runs in bounded workers and UI in sandboxed iframes; schema/SDK 1 packages are rejected before installation.
- Desktop, web, and mobile browse the public review-gated [extension marketplace](docs/extension-marketplace.md). Desktop additionally pins the approved release hash and signed manifest before showing the existing capability-review install step; mobile remains browse-only until it has an extension runtime.
- Installable offline browser client plus an Expo/React Native iOS and Android client using the same Workspace v4, FSRS and end-to-end encrypted operation protocol. Native workspaces use SQLite and device credentials use SecureStore. These are implementation capabilities, not a general drop-in claim; real-device and hosted-service launch gates remain.
- Main-process startup recovery that automatically reopens without local extensions if a package blocks renderer readiness.

The implemented boundary is documented in [docs/core-and-extensions.md](docs/core-and-extensions.md); extension authors can start with [docs/extension-authoring.md](docs/extension-authoring.md) and [docs/extension-sdk.md](docs/extension-sdk.md).

Maintainers should follow [docs/releasing.md](docs/releasing.md) for release checksums, SBOMs, provenance attestations, manual updates, platform warnings, and rollback.

## Run the desktop app

```bash
npm install
npm run desktop:dev
```

The renderer is sandboxed and has no Node.js access. A narrow preload bridge handles incremental persistence in the operating system's application-data directory. On macOS the primary workspace is normally `~/Library/Application Support/Neo Anki/neo-anki.sqlite`; automatic backups are retained under its `backups/` directory and recovery tries them newest-to-oldest until one passes integrity and semantic validation. Existing JSON workspaces migrate once and the original is preserved.

Build an installable macOS DMG and ZIP with:

```bash
npm run desktop:build
```

Artifacts are written to `release/`. Tagged releases are blocked unless macOS Developer ID signing/notarization and Windows Authenticode credentials are present and the resulting platform trust checks pass. CI also launches packaged builds and produces checksums, SBOMs, and GitHub provenance attestations. Local developer builds remain unsigned and are not release artifacts.

The Vite browser surface is an installable offline PWA with encrypted multi-device sync. Run it with `npm run dev`; production hosting must use HTTPS and configure the sync service’s allowed origin.

The native mobile client lives in `apps/mobile`. Verify both production bundles with `npm run mobile:check && npm run mobile:export`.

## Quality gates

```bash
npm run test:all
```

This runs ESLint with accessibility rules, TypeScript for renderer and Electron processes, unit/integration/component tests with enforced coverage, the production renderer build, browser accessibility/offline tests, and an Electron restart-persistence test. Install Chromium once with `npx playwright install chromium` if needed.

The risk-scoped coverage gate includes the compatibility importer, state/context, Electron persistence and extension services, SDK v2 runtime, sync, and native workspace/rendering code—not only utility modules. Current minimums are 75% statements, 64% branches, 73% functions, and 83% lines. The suite also generates current/legacy packages through pinned Anki, including a disposable hash-verified large-media collection.

Large-workspace daily planning is dispatched to an abortable worker after extension inputs are snapshotted in yielding batches. The browser gate exercises a real 5,001-card workspace with an independent UI heartbeat; the pure 50,000-card benchmark remains a throughput regression signal rather than permission to block the renderer.

## Planning model

FSRS owns memory state and future due dates. The planner learns review pace, subtracts practice already completed today, reserves the remaining daily target for due knowledge, forecasts reinforcement cost, and introduces only the new prompts that fit both today and the seven-day outlook. A user can spend that target in one session or several quick sessions.

The session composer is a separate deterministic layer. It can continue today’s mix, focus on one collection, or select urgent reviews only. Unrelated collections stay in short, coherent blocks; cards within a block remain interleaved while sibling prompts are kept apart. Switching context never changes a due date, and ending early leaves the rest of the plan intact.
