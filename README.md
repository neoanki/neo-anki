# Neo Anki

A TypeScript-first, device-first desktop spaced-repetition app that plans learning around a daily time budget instead of a fixed new-card quota.

> **Pre-1.0 status:** Neo Anki is an actively developed preview, not a drop-in Anki replacement. Desktop v0.2.2 is published; browser hosting, mobile stores, and hosted sync still have additional release gates. Check the notes attached to a published release for the behavior in its binaries, and keep independent backups of important collections.

## Current source-tree capabilities

- FSRS scheduling with a forecast-aware daily target, any-size practice sessions, and risk, oldest-first, or momentum backlog rescue.
- Adaptive session composition: a balanced mix, one-area focus, or urgent reviews, sequenced as coherent context blocks instead of random category switching.
- Basic, reverse, cloze, typed-answer, image-occlusion, and audio prompts over a canonical knowledge model.
- Visual authoring with media, multiple citations, duplicate detection, and actionable prompt-health diagnostics.
- Today, focused Review, searchable Library, Goals, Saved Views, and Shared Packs.
- Learning goals feed urgency into the daily planner rather than becoming a separate task list.
- Preflighted `.apkg`/`.colpkg` migration for the fixtures and transformations listed in the [compatibility contract](docs/anki-compatibility.md). Compatibility is bounded: modified repeat imports, large archives, whole-workspace replacement, and export fidelity have known gaps that are disclosed there.
- Patch-based shared packs with three-way merging, explicit conflict resolution, and preserved review history.
- Electron desktop application with integrated macOS window chrome, native menus and shortcuts, a study queue and card browser, canonical Workspace v4 SQLite persistence, content-addressed media, serialized saves, recovery backups, native backup restore/export, and light/dark themes. See the [claim evidence register](docs/claim-evidence.md) for the tested durability boundary.
- Trusted, compiled feature modules remain only where the public SDK does not yet provide an equivalent invariant-preserving seam: prompt types, image occlusion, Anki/CSV interoperability, recovery policies, goals/views, and shared packs.
- Card Timer and Memory Insights are independently released, signed SDK 2 extensions discovered through the marketplace; they no longer ship inside the renderer bundle.
- Installable `.neoanki-extension` packages use SDK 2 exclusively. Packages are signed, logic runs in workers, UI runs in sandboxed iframes, and schema/SDK 1 packages are rejected before installation. Lifecycle tests cover reload, disable/re-enable, update, rollback, uninstall, cancellation, and recovery.
- Desktop v0.2.2 includes the public review-gated [extension marketplace](docs/extension-marketplace.md), where [NeoAnki TTS 2.0.2](https://github.com/neoanki/neoanki-tts/releases/tag/v2.0.2) is the first production listing. Web and mobile can browse the same catalog; only desktop has an install runtime.
- An offline-capable browser client and an Expo/React Native iOS and Android client share Workspace v4, FSRS, and encrypted-sync packages. These are source capabilities, not claims of hosted-service readiness, real-device validation, or application-store availability.
- Main-process startup recovery that automatically reopens without local extensions if a package blocks renderer readiness.

The implemented boundary is documented in [docs/core-and-extensions.md](docs/core-and-extensions.md); extension authors can start with [docs/extension-authoring.md](docs/extension-authoring.md) and [docs/extension-sdk.md](docs/extension-sdk.md).

Maintainers should follow [docs/releasing.md](docs/releasing.md) for release checksums, SBOMs, provenance attestations, manual updates, platform warnings, and rollback.

## Run the desktop app

```bash
npm install
npm run desktop:dev
```

The renderer is sandboxed and has no Node.js access. A narrow preload bridge coordinates persistence in the operating system's application-data directory. On macOS the primary workspace is normally `~/Library/Application Support/Neo Anki/neo-anki.sqlite`; automatic backups are retained under its `backups/` directory and recovery tries them newest-to-oldest until one passes integrity and semantic validation. Existing JSON workspaces migrate once and the original is preserved. Until the documented projection risks are resolved, treat these recovery measures as safeguards rather than a no-loss guarantee.

Build an installable macOS DMG and ZIP with:

```bash
npm run desktop:build
```

Artifacts are written to `release/`. Tagged releases build without platform signing credentials: CI launches each packaged build and produces checksums, SBOMs, and GitHub provenance attestations. macOS Developer ID signing/notarization and Windows Authenticode signing are optional future improvements, not release or CI prerequisites. Local developer builds are not release artifacts.

The Vite browser surface is an installable offline PWA with encrypted-sync support. Run it with `npm run dev`; production hosting must use HTTPS and configure the sync service’s allowed origin. Hosted reliability and adversarial multi-device convergence remain release gates.

The native mobile client lives in `apps/mobile`. Verify both production bundles with `npm run mobile:check && npm run mobile:export`.

## Quality gates

```bash
npm run test:all
```

This runs ESLint with accessibility rules, TypeScript for renderer and Electron processes, unit/integration/component tests with enforced coverage, the production renderer build, browser accessibility/offline tests, and an Electron restart-persistence test. Install Chromium once with `npx playwright install chromium` if needed.

The risk-scoped coverage gate includes selected compatibility, state/context, Electron persistence and extension services, SDK v2 runtime, sync-client, and native workspace/rendering modules. It does not cover every sync, mobile, page, or failure path. Current minimums for the included files are 75% statements, 64% branches, 73% functions, and 83% lines. CI installs pinned Anki 25.9.4 for its corpus/oracle tests; that narrow fixture matrix does not imply compatibility with every Anki collection.

Large-workspace daily planning is dispatched to an abortable worker after extension inputs are snapshotted in yielding batches. The browser gate exercises a real 5,001-card workspace with an independent UI heartbeat; the pure 50,000-card benchmark remains a throughput regression signal rather than permission to block the renderer.

## Planning model

FSRS owns memory state and future due dates. The planner learns review pace, subtracts practice already completed today, reserves the remaining daily target for due knowledge, forecasts reinforcement cost, and introduces only the new prompts that fit both today and the seven-day outlook. A user can spend that target in one session or several quick sessions.

The session composer is a separate deterministic layer. It can continue today’s mix, focus on one collection, or select urgent reviews only. Unrelated collections stay in short, coherent blocks; cards within a block remain interleaved while sibling prompts are kept apart. Switching context never changes a due date, and ending early leaves the rest of the plan intact.
