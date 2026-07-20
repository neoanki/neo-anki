# Neo Anki drop-in blocker remediation status

This evidence ledger supplements the pinned comprehensive audit. It records implementation status in the current worktree; it does not retroactively change the audit’s historical observations and it does not authorize a public replacement claim.

| Minimum launch condition | Current implementation evidence | Gate status |
| --- | --- | --- |
| Preserve scheduling, history, card state, presets, note types/templates/CSS, fields, cloze ordinals, card decks, flags, suspension and bury state | Workspace v4 compatibility entities; import corpus and Anki oracle; rendering and scheduler strategy tests | Implemented; packaged corpus gate still required on every release |
| Distinguish `.apkg` and `.colpkg`; show field-level preflight | `ImportPreflight`, `ImportPreflightReview`, additive versus replace-profile commit paths | Implemented |
| Versioned current/legacy/malformed/large-media corpus | Generated fixtures under `test-fixtures/anki`; disposable 8 MiB/32-asset collection; pinned Anki 25.9.4 oracle | Implemented for declared schemas; future schemas require new fixtures |
| Verified interoperable rollback export | `.apkg`/`.colpkg` exporter and oracle re-import comparison | Implemented |
| Multi-device content, scheduling, deletion, meaningful-edit conflicts and media sync | Signed encrypted operation protocol, canonical conflict records/resolution operations, safe compaction acknowledgements, content-blind SQLite service, atomic resumable encrypted media, desktop/browser managers and Expo SQLite/SecureStore client | Implemented in source; native device and hosted-service operational gates remain |
| Exact due, TTS persistence/profile precedence, extension validation/reinstall atomicity | Exact-due planner tests; 18-test TTS SDK v2 coverage suite and packaged-core persistence/restart/playback/invalidation/cancellation journey; recovery install transaction and fault tests | Implemented |
| Installable runtime containment | Schema/SDK 2-only parser; same-origin reviewed worker gateway with no-network CSP/lockdown; opaque-origin no-network iframe; scoped DTO/RPC/patch host; signed reproducible Study Pulse and TTS packages | Implemented; SDK 1 parser, dynamic module loader, React host bridge and single-secret APIs removed |
| Desktop artifact integrity | Release jobs verify packaged launch, checksums, SBOMs and GitHub attestations without repository secrets | Implemented; platform signing/notarization remains an optional future trust improvement |
| Keyboard/dialog/contrast/text/targets | Shared modal focus handling, light/dark axe journeys with contrast enabled, explicit error alerts, 16 px defaults, 375/768/1024/1440 and 200% text/reduced-motion journey, responsive/touch rules, 48 px native controls | Implemented baseline; packaged platform accessibility audits remain |
| Mainstream library/statistics workflow | Note/card modes, search grammar, multi-select/bulk state and deck operations, due edits, custom study, editors and statistics | Implemented |
| Precise compatibility contract | `docs/anki-compatibility.md` and `docs/claim-evidence.md` | Implemented |
| Cancellable bounded migration and retained rollback | Incremental ZIP worker, prompt cancellation tests, durable verified archive activation, non-rotating verified checkpoints and explicit Settings removal UI | Implemented |
| Reproducible extension provenance | SDK v2 validates full source/core Git object IDs; TTS release stamps and verifies both immutable inputs inside the signed package | Implemented in source; pinned core ref must be updated to the eventual merged SDK v2 commit before tagging |
| Responsive large-workspace planning | Workspaces with 5,000 or more cards snapshot extension signals in yielding batches and plan in a disposable worker with abort, timeout and stale-result rejection | Implemented; 5,001-card production-browser heartbeat journey and 50,000-card pure planner benchmark are green |

## Current reproducible source baseline

- Core risk-scoped coverage: 43 files and 154 tests, with 76.25% statements, 64.47% branches, 73.85% functions and 84.55% lines. The removed test exercised the deleted full-trust SDK 1 renderer loader; schema-1 rejection is covered directly by the package-format suite.
- Browser acceptance: 16 journeys, including full contrast analysis in both themes, offline reload, malformed migration alert semantics, a real 5,001-card worker/heartbeat scenario, four launch widths, 200% text scaling and reduced motion.
- Electron acceptance: all 8 runnable development journeys and the separately invoked exact packaged-launch journey passed against a freshly built unsigned local macOS application. Release workflows run the same packaged journey without requiring platform signing/notarization.
- Native delivery: TypeScript checks, both iOS and Android production exports, and all 20 Expo Doctor checks passed. Real-device accessibility, offline and recovery journeys remain release gates.
- Supply chain: CycloneDX 1.5 SBOM generation produced 984 core components; Study Pulse rebuilt byte-identically against the single SDK package at SHA-256 `27b5f5d8…`. The high-severity audit gate passes, with 11 moderate advisories confined to Expo's `xcode`/`uuid` toolchain and no non-breaking upstream fix currently available.
- TTS: 18 tests with enforced risk-scoped coverage (74.27% statements, 57.85% branches, 82.17% functions and 85.95% lines), zero dependency vulnerabilities, a 111-component CycloneDX 1.5 SBOM, byte-identical rebuilds against `@neo-anki/extension-sdk` 2 at SHA-256 `f008fa25…`, signed source/core provenance, and a green mocked packaged-core journey. No paid endpoint or real credential is used.

## Claim state

The product claim remains **not yet a general drop-in replacement**. The remaining claim gates are external or empirical: real iOS/Android device journeys, hosted-service reliability and recovery exercises, four-persona migration runs with disposable collections, and the comparative UX study defined by the remediation plan. Platform signing/notarization is an optional future improvement, not a claim or release gate. Source implementation or heuristic review cannot substitute for those results.
