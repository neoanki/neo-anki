# macOS arm64 desktop benchmarks

Neo Anki measures the packaged Electron product on Apple Silicon. Browser previews, native mobile, Intel macOS, Windows, Linux, optional extensions, Anki imports, TTS, native file-picker think time, and external-application startup are outside this performance contract.

## What is measured

The authoritative catalog is `benchmarks/desktop/catalog.ts`. It classifies lifecycle, recovery, navigation, Today, authoring, Library, review, settings, and sync operations as measured, setup-only, OS-owned, or excluded. `npm run benchmark:desktop:catalog` rejects duplicate entries, missing budgets, unclassified routes, and unclassified desktop IPC channels.

Each interaction can produce three latency boundaries:

1. **Feedback** starts at the captured user event and ends after the next completed paint.
2. **Settled** ends when the semantic user-visible outcome is ready.
3. **Durable** ends when Workspace v4 confirms the persisted outcome.

The renderer probe also records long tasks and animation-frame gaps. Electron process metrics capture CPU and memory around every operation. Lifecycle instrumentation emits structured `neo-anki-benchmark` marks for app readiness, window loading, workspace loading, saves, and shutdown.

Fixtures are generated outside the timed interval:

| Dataset | Knowledge items/cards | Review events |
| --- | ---: | ---: |
| Fresh | 0 | 0 |
| Small | 120 | 400 |
| Typical | 5,000 | 25,000 |
| Large | 50,000 | 100,000 |

The packaged app migrates these fixtures through its normal legacy-workspace path on first launch. Timed mutations always use the visible product UI.

## Commands

Build the current Apple Silicon package once:

```sh
npm run benchmark:desktop:pack
```

The pack command provisions and validates the arm64 Electron runtime through `desktop:runtime`, then gives that local distribution to electron-builder. This avoids a second release download and keeps CI package preparation reproducible.

Then run the desired tier:

```sh
npm run benchmark:desktop:smoke
npm run benchmark:desktop:full
npm run benchmark:desktop:calibrate
npm run benchmark:desktop:endurance
```

Override `NEO_ANKI_BENCHMARK_APP` when testing a release-candidate executable. Results are written under `test-results/desktop-benchmark/results/` as raw JSONL, summary JSON, calibrated budgets, and Markdown. Playwright traces, screenshots, videos, and HTML reports use the adjacent benchmark result directories.

Compare two complete reports on the same class of machine:

```sh
npm run benchmark:desktop:compare -- /path/to/base/summary.json /path/to/head/summary.json
```

The comparison requires all three regression guards: more than 15 percent, more than 10 milliseconds, and more than three pooled median absolute deviations.

## Calibration and enforcement

Calibration performs one unrecorded warm-up and 20 measured iterations for normal scenarios. The large 50,000-card fixture is capped at three repetitions because fixture migration and profile cleanup dominate machine time without improving interaction variance.

Initial ceilings are 100 ms for feedback, 250 ms for normal settlement, 500 ms for large-data settlement, 1 second for normal durable mutations, 2 seconds for large mutations, 3 seconds for normal launch, 5 seconds for large launch or pending-save shutdown, and 2 seconds for idle shutdown.

Calibration never hides existing debt. A metric whose p95 meets its ceiling becomes `gated`; an existing overrun becomes `debt` and must not regress. Missing samples, incorrect visible outcomes, persistence mismatches, crashes, and runtime errors fail independently of timing budgets.

The accepted current-machine calibration is checked in at `benchmarks/desktop/budgets.macos-arm64.json`. Normal smoke, full, and endurance runs enforce its `gated` ceilings; `debt` entries remain report-only until the paired base/head comparison establishes a no-regression decision.

Pull-request smoke runs set `NEO_ANKI_BENCHMARK_REPORT_ONLY=1` because GitHub’s virtual Apple Silicon runner is not the calibrated physical host. This suppresses only absolute timing-budget failures; correctness failures, crashes, timeouts, missing measurements, and durable-state mismatches remain fatal. The emitted PR artifact is retained for runner-specific base/head calibration.

Automated benchmarks remain headless. `NEO_ANKI_BENCHMARK=1` only enables structured timing marks and disables background throttling for the hidden benchmark renderer; it does not bypass application behavior or persistence.

## Sync safety

The operation catalog includes core sync. Account and credential benchmarks require an ephemeral macOS keychain plus the local sync service; they must never use the developer’s login Keychain. All normal local commands skip the credential journey before launching its app profile, so they do not probe Keychain or show an authorization dialog. CI or release QA may set `NEO_ANKI_BENCHMARK_SYNC_CREDENTIALS=1` only after provisioning an isolated keychain and must restore the original keychain search list afterward.
