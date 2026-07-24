# QA automation

Neo Anki’s automated quality strategy is outside-in and adversarial. Product behavior, persistence, security boundaries, accessibility, responsive UX, documentation, content, and learning guidance are all testable product contracts. The source tree is compared with the latest public release; responsive browser coverage is never reported as native-mobile coverage.

## Headless contract

Every Playwright configuration explicitly imports `headlessEvidenceUse`, which sets `headless: true` and retains screenshots, traces, and videos on failure. Electron launches set `NEO_ANKI_E2E_HEADLESS=1`; the main process keeps application windows hidden while the automation renderer remains available. `npm run qa:headless` rejects a headed Playwright option, an Electron launch without the hidden-window contract, or native automation that would open the Simulator UI.

Native Android runs create a dedicated emulator with `-no-window`; they refuse to reuse an emulator whose launch flags cannot be proven. Native iOS runs use `xcrun simctl` without launching the Simulator application. Physical VoiceOver, TalkBack, thermal, interruption, and hardware checks remain a separate manual release gate.

## Commands and tiers

| Tier | Command | Boundary |
| --- | --- | --- |
| Contract | `npm run qa:contracts` | Headless configuration and documentation links, commands, versions, and release notes |
| Unit/property | `npm run test:unit` | Workspace invariants, scheduling, planning, serialization, import/export, sync, extension, and UI contracts |
| Source browser | `npm run test:e2e` | Chromium, Firefox, WebKit, responsive/mobile-web, accessibility, recovery, offline, and adversarial journeys |
| Source Electron | `npm run test:desktop` | Hidden-window desktop persistence, restart, extension, import, and security journeys |
| Released binary | `NEO_ANKI_RELEASE_APP=/absolute/path npm run test:acceptance:release` | Exact packaged executable with isolated application data and restart verification |
| macOS arm64 benchmark | `npm run benchmark:desktop:pack && npm run benchmark:desktop:smoke` | Packaged Apple Silicon app lifecycle, interaction, persistence, renderer, CPU, and memory measurements |
| Known bugs | `npm run test:known-bugs` | Deterministic, non-gating reproducers linked to unresolved issues |
| Android native | `NEO_ANKI_MOBILE_APP=/absolute/app.apk NEO_ANKI_ANDROID_AVD=qa npm run mobile:e2e:android` | Built APK on a runner-created no-window emulator |
| iOS native | `NEO_ANKI_MOBILE_APP=/absolute/NeoAnki.app NEO_ANKI_IOS_SIMULATOR_UDID=... npm run mobile:e2e:ios` | Built simulator binary through headless `simctl` plus Maestro |

Pull requests run contracts, deterministic tests, browser journeys, and hidden-window Electron tests. The nightly workflow increases property-test cases, runs the cross-browser matrix, and keeps known-bug reproducers non-gating. Release workflows must test the exact packaged executable and upload failure evidence. A mobile release candidate additionally needs both native suites against built binaries.

The packaged performance program is documented in [macOS arm64 desktop benchmarks](desktop-benchmarks.md). Pull requests use the critical smoke journey, nightly QA runs the full catalog, and calibration uses 20 repetitions before budgets become gating. Performance artifacts identify the exact executable hash and host hardware.

## Evidence and isolation

Tests use isolated browser profiles, Electron data directories, and temporary workspaces. Browser and Electron failures collect runtime console/page errors as assertions. Packaged acceptance checkpoints store full-page screenshots and inspect durable Workspace v4 counts after restart. Release evidence must identify the version or commit, artifact path and SHA-256, platform, architecture, viewport/theme when relevant, seed, runtime failures, and durable entity counts.

Do not add production-accessible QA bypasses. Faults are injected through test-only browser APIs, disposable services, corrupt fixtures, filesystem permissions, process termination, and isolated secrets.

## Defect lifecycle

Search open and closed issues before filing. Use the QA defect form and apply one severity label plus relevant area labels. A confirmed unresolved defect should have a deterministic reproducer in `e2e/known-bugs` when technically possible. Move the reproducer into a gating suite after correction. Distribution-visible defects close only after source and affected packaged-artifact regression runs pass.

P0/P1 failures, skipped required artifact suites, unexplained runtime errors, data loss, security failures, inaccessible critical controls, and unsupported release claims block release. P2 requires an explicit release decision; P3 enters the backlog. Required suites must have no unexplained skips and should remain below a one-percent flake rate.
