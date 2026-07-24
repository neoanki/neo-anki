# Neo Anki

A TypeScript-first, device-first desktop spaced-repetition app that plans learning around a daily time budget instead of a fixed new-card quota.

> **Pre-1.0 status:** Neo Anki is an actively developed preview, not a drop-in Anki replacement. Desktop v0.5.0 is the coordinated declarative-settings cutover; browser hosting, mobile stores, and hosted sync still have additional release gates. Check the notes attached to a published release for the behavior in its binaries, and keep independent backups of important collections.

## Current source-tree capabilities

- FSRS scheduling with a forecast-aware daily target and any-size practice sessions; optional marketplace extensions add alternate backlog ordering.
- Adaptive session composition: a balanced mix, one-area focus, or urgent reviews, sequenced as coherent context blocks instead of random category switching.
- Native content types with named fields and reusable card templates. Templates select prompt, answer, supporting fields, and reveal or typed interaction without HTML, inline CSS, or card iframes.
- Schema-driven authoring with a native live preview, media, multiple citations, duplicate detection, and actionable prompt-health diagnostics. Desktop, browser, and mobile use the same structured card projector.
- Today, focused Review, searchable Library, and extension surfaces for goals, saved searches, import and export, and learning packs.
- Goals & Saved Searches lets learners set goals that influence daily priorities and reopen frequently used Library searches.
- Anki & CSV Import/Export previews and imports `.apkg`, `.colpkg`, and CSV files, exports the current collection, and creates a rollback checkpoint before every import. Known format limitations are documented in the [compatibility contract](docs/anki-compatibility.md).
- Learning Packs installs reusable sets of notes and cards, applies publisher updates, and preserves local edits and review progress.
- Electron desktop application with integrated macOS window chrome, native menus and shortcuts, a study queue and card browser, canonical Workspace v4 SQLite persistence, content-addressed media, serialized saves, recovery backups, native backup restore/export, and light/dark themes. See the [claim evidence register](docs/claim-evidence.md) for the tested durability boundary.
- Every optional feature formerly under the internal extension registry now ships from its own public repository as an independently released, signed SDK 2 package; none are compiled into the renderer bundle.
- Installable `.neoanki-extension` packages use SDK 2 exclusively. Packages are signed, logic runs in workers, executable UI runs in sandboxed iframes, and configuration is host-rendered from inert manifest data. Schema/SDK 1 packages are rejected before installation. Lifecycle tests cover reload, disable/re-enable, update, rollback, uninstall, cancellation, and recovery.
- Desktop v0.4.2 includes the public review-gated [extension marketplace](docs/extension-marketplace.md), with nine independently released packages. Web and mobile can browse the same catalog; only desktop has an install runtime.
- An offline-capable browser client and an Expo/React Native iOS and Android client share Workspace v4, FSRS, and encrypted-sync packages. These are source capabilities, not claims of hosted-service readiness, real-device validation, or application-store availability.
- Main-process startup recovery that automatically reopens without local extensions if a package blocks renderer readiness.

The implemented boundary is documented in [docs/core-and-extensions.md](docs/core-and-extensions.md); extension authors can start with [docs/extension-authoring.md](docs/extension-authoring.md) and [docs/extension-sdk.md](docs/extension-sdk.md).

Maintainers should follow [docs/releasing.md](docs/releasing.md) for release checksums, SBOMs, provenance attestations, manual updates, platform warnings, and rollback.

## Install the desktop app

Download the current macOS, Windows, or Linux build from the [latest GitHub release](https://github.com/neoanki/neo-anki/releases/latest). Follow the short platform guide for installation and unsigned-build warnings:

- [macOS](docs/install-macos.md)
- [Windows](docs/install-windows.md)
- [Linux](docs/install-linux.md)

On first launch, **Start fresh** creates an empty local workspace. Add your first knowledge item from Today, customize fields and card templates in Settings, or open Extensions to install import, audio, planning, and sharing features. See [Card templates](docs/card-templates.md) for the native content model. Keep an independent backup of important collections while Neo Anki remains pre-1.0.

## Develop the desktop app

```bash
npm install
npm run desktop:dev
```

The renderer is sandboxed and has no Node.js access. A narrow preload bridge coordinates persistence in the operating system's application-data directory. On macOS the primary workspace is normally `~/Library/Application Support/Neo Anki/neo-anki.sqlite`; automatic backups are retained under its `backups/` directory and recovery tries them newest-to-oldest until one passes integrity and semantic validation. Existing JSON workspaces migrate once and the original is preserved. Until the documented projection risks are resolved, treat these recovery measures as safeguards rather than a no-loss guarantee.

Build an installable macOS DMG and ZIP with:

```bash
npm run desktop:build
```

Artifacts are written to `release/`. Tagged macOS releases are ad-hoc signed and launch-tested; users must verify the checksum and GitHub provenance attestation and approve the first launch in macOS because Developer ID notarization is deferred. Windows and Linux builds are also launched and inspected; Windows Authenticode signing is not yet a release prerequisite. CI produces checksums, SBOMs, and GitHub provenance attestations for the packaged artifacts. Local developer builds are not release artifacts.

The Vite browser surface is an installable offline PWA with encrypted-sync support. Run it with `npm run dev`; production hosting must use HTTPS and configure the sync service’s allowed origin. Hosted reliability and adversarial multi-device convergence remain release gates.

The native mobile client lives in `apps/mobile`. Verify both production bundles with `npm run mobile:check && npm run mobile:export`. Native binary acceptance uses headless Maestro flows; see the [QA automation guide](docs/qa-automation.md).

## Quality gates

```bash
npm run test:all
```

This runs the headless-policy and documentation contracts, ESLint with accessibility rules, TypeScript for renderer and Electron processes, unit/integration/component tests with enforced coverage, the production renderer build, browser accessibility/offline tests, and Electron restart-persistence tests. Install Chromium once with `npx playwright install chromium` if needed.

The risk-scoped coverage gate includes selected compatibility, state/context, Electron persistence and extension services, SDK v2 runtime, sync-client, and native workspace/rendering modules. It does not cover every sync, mobile, page, or failure path. Current minimums for the included files are 75% statements, 64% branches, 73% functions, and 83% lines. CI installs pinned Anki 25.9.4 for its corpus/oracle tests; that narrow fixture matrix does not imply compatibility with every Anki collection.

Large-workspace daily planning is dispatched to an abortable worker after extension inputs are snapshotted in yielding batches. The browser gate exercises a real 5,001-card workspace with an independent UI heartbeat; the pure 50,000-card benchmark remains a throughput regression signal rather than permission to block the renderer.

## Planning model

FSRS owns memory state and future due dates. The planner learns review pace, subtracts practice already completed today, reserves the remaining daily target for due knowledge, forecasts reinforcement cost, and introduces only the new prompts that fit both today and the seven-day outlook. A user can spend that target in one session or several quick sessions.

The session composer is a separate deterministic layer. It can continue today’s mix, focus on one collection, or select urgent reviews only. Unrelated collections stay in short, coherent blocks; cards within a block remain interleaved while sibling prompts are kept apart. Switching context never changes a due date, and ending early leaves the rest of the plan intact.
