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

Automated benchmarks remain headless. `NEO_ANKI_BENCHMARK=1` only enables structured timing marks and disables background throttling for the hidden benchmark renderer; it does not bypass application behavior or persistence.

## July 24, 2026 performance redesign

The current calibration was recorded from the packaged arm64 application on an Apple M3 Pro running macOS 26.5.2. It used five measured repetitions after an unrecorded warm-up; the large scenario used its standard three measured repetitions. Values below are p95.

| Target | Previous | Current | Feedback | Result |
| --- | ---: | ---: | ---: | --- |
| 50,000-card launch | 17,140.55 ms | 1,459.91 ms | — | Meets the 2 s target |
| Learning settings durable | 3,139.57 ms | 255.65 ms | 18.68 ms | Visible immediately; 5.65 ms over the 250 ms stretch target |
| Template save durable | 2,697.93 ms | 168.75 ms | 13.38 ms | Meets 250 ms |
| Preset save durable | 2,718.84 ms | 132.16 ms | 13.82 ms | Meets 250 ms |
| Bulk state durable | 1,556 ms | 110.21 ms | 46.28 ms | Meets 500 ms |
| Bulk metadata durable | 1,544 ms | 108.02 ms | 43.44 ms | Meets 500 ms |
| Review undo durable | 1,526 ms | 52.77 ms | 43.74 ms | Meets 500 ms |
| 50,000-card planning | 1,942 ms | 181.07 ms | — | Meets 250 ms |
| Cold route ready | ~836 ms | 41.55 ms | 14.77 ms | Meets 250 ms |
| Study session ready | ~820 ms | 32.48 ms | 13.38 ms | Meets 250 ms |

Large Library first paint is 24.10 ms and semantic settlement is 128.70 ms. Its worst observed renderer task was 67 ms and worst frame gap was 75 ms; no measured renderer task crossed 100 ms. Across the calibrated operation samples, peak aggregate Electron CPU was 25.23%. The largest transient per-operation RSS increase was 266.24 MiB during large-data materialization and was reclaimed rather than retained. The separate 100-transition endurance run retained 52,592,640 bytes (9.98%), satisfying the gate because growth did not exceed both 50 MiB and 10%; warm-route p95 was 18.81 ms feedback and 47.26 ms settled with no long tasks.

### Critical-path findings

The old outer timings combined several independent costs:

- Launch synchronously parsed and validated the complete legacy graph, constructed normalized SQLite rows, regenerated a canonical v4 document, and hydrated/planned the renderer before exposing Today.
- Every renderer update cloned and validated the full application graph, diffed all collections, then the main process rewrote normalized rows, projected and validated the full v4 workspace, serialized it, and made a complete online backup.
- Template and preset edits fetched and returned a complete workspace document around a narrow patch.
- Planning repeatedly sorted complete due/new queues and yielded hundreds of times in the renderer.
- Lazy route chunks and first-route derivations delayed otherwise small navigations.

The representative 50,000-card launch trace now reaches Electron ready at 53 ms, completes window/document loading at 419 ms, completes the asynchronous workspace handoff at 426 ms, and reports the first useful workspace at 1,286 ms from main-module start. The preserved legacy source is validated and checkpointed in a worker after the useful screen; a representative full background migration took 6.55 s but contributed zero time to semantic launch readiness. A write or v4 editor request forces that migration first, so deferred work cannot be mistaken for durable completion.

The remaining measured critical paths are:

- Learning-settings durability lands just beyond the harness's 250 ms polling boundary even though feedback is 18.68 ms and the narrow journal transaction is already complete around that boundary.
- The first template-manager expansion is still initialization-bound (324.79 ms p95 pooled with its fast second expansion). Saving the template itself is 168.75 ms durable.
- Large Library first render materializes its first 100 rows before progressively deriving health/search indexes; this produces the 67 ms worst task while remaining below the 100 ms ceiling.

## July 24, 2026 launch, durability, and footprint pass

This pass targeted the remaining large-workspace launch cost, settings durability, first Template Manager initialization, and avoidable footprint. It was recorded on the same Apple M3 Pro / macOS 26.5.2 machine using the standard calibration (one warm-up, 20 measured iterations; the large scenario uses its three). Before/after are p95 unless noted; the paired comparison passed all three regression guards (>15%, >10 ms, >3 pooled MADs) with no regression.

| Target | Before p95 | After p95 | After median | Result |
| --- | ---: | ---: | ---: | --- |
| 50,000-card launch | 1,659.1 ms | 982.0 ms | 849.3 ms | −41%; well under the 2 s ceiling, above the 750 ms stretch (see constraint below) |
| Established launch | 768.2 ms | 502.5 ms | 483.9 ms | −35% |
| Fresh launch | 477.8 ms | 463.0 ms | 433.9 ms | Within noise |
| Learning settings durable | 312.5 ms | 277.6 ms | 273.5 ms | −11%; feedback stays ~18 ms |
| Template Manager load (pooled) | 325.9 ms | 322.7 ms | 121.8 ms | Median −15%; p95 renderer-init bound (below) |
| 50,000-card planning | 182.6 ms | 171.1 ms | 86.9 ms | −53% median |

### What changed

- **Launch, main process.** The legacy `neo-anki-data.json` preserve-copy and `JSON.parse` moved out of the `WorkspaceStore` constructor to the first workspace load, so the O(file-size) read no longer blocks window creation. The trace now reaches `application-window-ready` around 230 ms and `renderer-ready` around 245 ms even for the 50k fixture.
- **Launch, IPC transfer.** The projection crosses to the renderer as one pre-serialized JSON string parsed once, instead of a structured clone of the whole 200k-entity graph. A synthetic 50k/100k graph measured the structured-clone round-trip at ~456 ms of V8 work versus ~293 ms for stringify+parse, with the renderer-side deserialize dropping from ~271 ms to ~147 ms. On the unvalidated legacy fast path the original file text is reused verbatim, skipping even the main-side re-stringify.
- **Durability.** The once-per-local-day online backup no longer sits on the mutation acknowledgment path. The journal COMMIT (WAL + `synchronous = FULL`) is the crash-safe boundary; the backup runs afterward, still serialized on the save queue, so it cannot interleave and still completes before a pending-save quit flush.
- **Template Manager.** The main-process editor-document builder selects one representative note per note type in a single O(notes) pass instead of an O(noteTypes × notes) `find` per type, cutting the load median from 142 ms to 122 ms.
- **Footprint & CPU.** Route code is served as one initial bundle again after a code-split experiment regressed first navigation (cold route 46 ms → 833 ms) — the split's ~100 KB initial-parse saving was not worth an ~800 ms first-navigation penalty, so it was reverted. `sql.js` (~18 MiB, no production use — only a desktop test imports it) moved to devDependencies, trimming the install/`node_modules` footprint. SQLite gained a bounded 16 MiB page cache and a 256 MiB `mmap_size` cap, and the hottest per-mutation statements (journal append, meta and workspace_v4 upsert) are prepared once and cached. Large-workspace planning improved 53% (the worker's DB reads benefit from the cache and mmap).

### Resource results

Peak aggregate Electron CPU across calibrated samples stayed in the same ~25% band. The 100-operation endurance loop retained 51,134,464 bytes (9.69%), passing the gate and improving on the prior 52.6 MB / 9.98% (this machine's fresh baseline before the pass was 55.2 MB / 10.48%, which failed). The worst renderer task (98 ms) and worst frame gap (100 ms) both occur in the large-Library progressive first-page render, which stays below the 100 ms ceiling; no other operation approaches those figures.

### Remaining measured constraints

- **50k launch stretch (≤750 ms).** After removing the redundant serialization, the remaining ~980 ms is dominated by two mandatory 60 MB JSON parses on the critical path: the main-process validation parse (~150 ms, on the measured `workspace-load` span) that gates the unvalidated fast path and preserves the write-before-migration safety invariant, plus the renderer materialization parse (~147 ms) and the React render of the 50k/50k/100k arrays. Eliminating the main-side parse would require restructuring the deferred-migration data-safety contract (`hasDeferredLegacyMigration`, `finishDeferredLegacyMigration`, and the write-before-migration guard all depend on the parsed projection); a Today-first bootstrap that paints before the full parse would trip Today's `items.length === 0` empty-state and flash content on a real workspace. Both were judged too risky against the "do not worsen UX" and data-safety constraints for a stretch (not ceiling) target, so they are documented rather than shipped.
- **Learning-settings durable (~278 ms).** The journal commit lands well under 250 ms and feedback is ~18 ms; the residual is Playwright `expect.poll` quantizing the DOM `.persistence-status` signal up to its ~250 ms tick. This is a harness measurement artifact, not product latency, and was not gamed.
- **Template Manager first expansion (~322 ms pooled p95).** The main-process document build is now O(notes); the residual p95 is renderer-side React initialization of the editor form on first mount, which the median improvement (−15%) reflects once warm.

## Sync safety

The operation catalog includes core sync. Account and credential benchmarks require an ephemeral macOS keychain plus the local sync service; they must never use the developer’s login Keychain. All normal local commands skip the credential journey before launching its app profile, so they do not probe Keychain or show an authorization dialog. CI or release QA may set `NEO_ANKI_BENCHMARK_SYNC_CREDENTIALS=1` only after provisioning an isolated keychain and must restore the original keychain search list afterward.
