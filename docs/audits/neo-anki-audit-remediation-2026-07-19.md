# Neo Anki 0.2.0 audit remediation ledger

This ledger closes the findings in `neo-anki-comprehensive-audit-2026-07-19.md` against the 0.2.0 stabilization release. “Closed by control” means risky or unsupported behavior is explicitly bounded or removed rather than claimed as implemented. Tagged releases rerun static, unit, Anki-oracle, browser, desktop-durability, mobile-export and packaged-launch gates and emit platform evidence manifests.

| Findings | Resolution in 0.2.0 | Primary evidence |
| --- | --- | --- |
| DATA-001 | Lossless transitional envelopes preserve variants, prompt data, citations, media, occlusions, provenance, extension data and accessibility text. | Workspace round-trip and desktop store tests |
| DATA-002 / UX-001 | Serialized snapshots rebase after acknowledged persistence and flush before v4/import operations; global failed-save recovery is visible. | Delayed rapid-save regression |
| DATA-003 / PACK-001 | Tombstoned notes/cards remain review-addressable, disappear from live projections and restore with their IDs; pack mappings update transactionally. | Trash/restore and pack tests |
| ARCH-001 | Workspace v4 is durable authority; v3 is a compatibility projection. Semantic equality suppresses revision churn and the supported adapter round-trips losslessly. | Unchanged revision and round-trip tests |
| ARCH-002 | Profile ownership, reciprocal note-type ownership, ordinals, template/card consistency, one active profile, deck cycles, resource bounds and malformed entities are validated with indexed checks. | Domain negative tests |
| DATA-004 / DATA-005 | Media alt text is durable; owner/key/request-hash patch receipts make delivery restart-safe and idempotent. | Workspace and patch-replay tests |
| SYNC-001 / SYNC-003 / SYNC-006 | Ordered 2,000-operation chunks retain unacknowledged work; remote pages and ledger batches stage atomically before graph validation/cursor advancement. | 4,501-operation, page-split and rejection tests |
| SYNC-002 | Reappearing tombstoned entities emit explicit authenticated restores. | Delete/restore replica test |
| SYNC-004 / PED-008 | Consumers sort reviews by timestamp/ID; undo chooses the newest local inverse-bearing action and appends a reversal. | Ordering and undo tests |
| SYNC-005 | Settings, goals, views, packs, conflicts, Trash and tombstones sync independently with legacy compatibility. | Unrelated offline-state convergence test |
| SYNC-007 | Client and service reject clocks more than 24 hours in the future. | Skew tests |
| OPS-001 | SQLite-shared rate windows, quotas, response caps, metrics and an isolated backup-restore drill are defined; external ingress limits remain mandatory. | Service tests and sync runbook |
| EXT-001 / EXT-002 | Renderer teardown/reload/disable/uninstall revokes claims and token-owned network work; diagnostics use a bounded ring. | Extension lifecycle/registry tests |
| EXT-003 / EXT-004 | Canonical note paging avoids full projection; downgrade checks use SemVer prerelease precedence. | Store paging and precedence tests |
| PACK-002 | Pack cards carry stable IDs and complete per-card variant/prompt/occlusion data, including multiple cloze ordinals. | Shared-pack tests |
| MOD-001 | Unsafe snapshot Browser Tab Sync was removed from runtime, exports and claims. | Registry/build |
| PED-001 / PED-002 / PED-003 | Desktop/mobile use card presets; current review queues skip buried siblings; planners enforce per-preset limits with card-level deck identity. | FSRS, planner and mobile tests |
| PED-004 / PED-005 | Preview is explicit and excluded from evidence/export; successful recall is Good/Easy and active duration is prompt-to-grade on both clients. | Context, Insights and mobile tests |
| PED-006 | Configured daily new-card limits bound intake; forecasts remain explicitly described as heuristics, not efficacy guarantees. | Planner tests and UI copy |
| PED-007 | Typed practice offers keyboard-accessible blank “I don’t know — reveal.” | Review workflow |
| MOB-001 / MOB-002 | One versioned mobile queue serializes commands, saves and sync; stale commits fail, errors surface and grading is guarded immediately. | Mobile workspace/storage tests |
| MOB-003 | Closed by release control: the iOS/Android screen-reader, 200% font, lifecycle, slow I/O/network and process-death matrix is published in `docs/mobile-release-checklist.md`; automated bundles are necessary but not sufficient. | Checklist and CI bundle |
| IMP-001 / IMP-003 | Stable Anki collection identity prevents changed-source duplication; `.colpkg` replacement is scoped to the matching active profile and preserves Neo client state/other profiles. | Import/store tests |
| IMP-002 | Closed by supported-scope control: the worker rejects files over 64 MiB before allocation and caps entry, expanded, SQLite and envelope budgets; larger collections must be split. | Import limit tests |
| IMP-004 / TEST-002 | Compatibility docs distinguish inert retention from supported re-emission; oracle absence is an explicit local skip and CI/release requires pinned Anki 25.9.4. | Compatibility corpus and workflows |
| A11Y-001 / A11Y-002 / A11Y-003 | Coarse-pointer controls have a 44 px floor, imported frames resize through a bounded source/token protocol, progress means completed cards and motion preferences are honored. | Axe/Playwright and component tests |
| UX-002 | Typed hash routes support reload/back/extension destinations; unknown routes recover to Today and navigation moves focus to main content. | App/E2E tests |
| PERF-001 / PERF-002 | Projection/invariant foreign keys and extension paging are indexed; Insights indexes reviews by card/day in one pass. | Projection/Insights tests |
| PERF-003 | Noncritical routes and Anki export load lazily; React, validation and scheduler chunks have a 500 kB budget. | Production build |
| TEST-001 / CI-001 | Durability regressions are automated; core web journeys run Chromium, Firefox and WebKit; desktop runs Linux, Windows and both macOS architectures. | CI workflow |
| REL-001 | Tagged verification reruns browser, desktop, oracle and mobile gates before signed/notarized builds; outputs include evidence, SBOMs, checksums and attestations. | Release workflow |
| DOC-001 | Claims now map to current automated evidence and supported limits; this ledger supersedes the pre-fix recommendation. | Claim-evidence and architecture docs |
| DEP-001 | The one build-time Expo/xcode UUID advisory is registered with reachability, controls, upstream state and expiry; no high/critical advisories remain. | Dependency risk register |
| SEC-001 | The browser same-origin key-use boundary and high-sensitivity recommendation are explicit. | Browser sync security doc |

## Release-gate findings discovered during remediation

These defects were not part of the original pre-fix audit. They were found by the clean CI and security-analysis matrix while preparing 0.2.0, fixed on the release branch, and retained here so future maintenance does not lose their regressions.

| Finding | Resolution in 0.2.0 | Primary evidence |
| --- | --- | --- |
| CI-002 — Desktop extension journey selected a stale versioned artifact | The journey derives the package ID and version from the built extension manifest, so a clean build and a developer tree select the same artifact. | Cross-platform desktop E2E |
| SEC-002 — Plain-text rendering could decode nested entities more than once | Named entities are decoded through one combined replacement pass; encoded markup remains encoded after one text conversion. | Card-rendering regression and CodeQL |
| SEC-003 — Worker lockdown JavaScript was assembled through interpolation | The network/global lockdown prelude is a fixed host-owned bootstrap prepended to the separately verified extension entry. | Desktop extension E2E and CodeQL |
| DATA-006 — Retained Anki archives used a read-only handle for `fsync` | Archive files are flushed through a writable descriptor, while best-effort directory metadata flushing remains a separate operation. This preserves the rollback guarantee and avoids Windows `EPERM`. | Workspace-store integration and Windows desktop E2E |

## Release exit gate

Release is eligible only when the complete local matrix and all required GitHub checks pass on the release commit. A failed required oracle, desktop durability journey, artifact trust check, checksum, SBOM validation or attestation blocks publication.
