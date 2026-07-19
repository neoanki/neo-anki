# Public claim evidence register

Every public claim must remain weaker than its current evidence. A passing unit test proves only its exercised case; presentation quality, an implemented primitive, or a planned release gate is not evidence that an end-to-end property holds.

Status below is aligned with the comprehensive audit dated July 19, 2026. Re-run the audit and update this register before broadening public wording.

| Area | Allowed public wording | Known limit that must remain disclosed | Gate for stronger wording |
| --- | --- | --- | --- |
| Daily planning | Neo Anki uses FSRS state, a daily time budget, and a seven-day heuristic to estimate a study plan. | Forecasted reinforcement cost is heuristic and is not evidence of improved retention, completion, or fatigue. | Calibrated forecast study on representative, opt-in/local datasets. |
| Anki import | `.apkg`/`.colpkg` imports use a preflight and support the pinned fixtures listed in the compatibility contract. | Modified repeat imports can duplicate; large inputs are not bounded-memory; `.colpkg` replacement can replace unrelated workspace state; export does not prove arbitrary unknown-field fidelity. | Versioned compatibility matrix, stable source identity, bounded-memory suite, scoped replacement, and pinned round-trip oracle all pass. |
| Persistence and backups | Desktop stores a SQLite workspace, creates recovery backups, and retains migration rollback files. | v4 is reconstructed from a legacy projection on saves; rich variants, citations, media links, occlusions, and review history can be lost, and overlapping saves can regress state. | One canonical v4 mutation/persistence coordinator plus rich round-trip, rapid-grade, fault, and restart suites. |
| Review history | Review and undo data are represented in Workspace v4 and encrypted-sync operations. | Current projection and overlapping-save paths do not prove append-only durability or convergence. | Atomic idempotent review command and multi-client reversal/convergence suites. |
| Encrypted sync | Clients encrypt and sign workspace/media operations before sending them to the relay. | E2EE primitives do not establish hosted reliability or full convergence; operation limits, page atomicity, delete/restore semantics, clock skew, and coarse client-state conflicts remain. | 100k-operation, adversarial page split, offline conflict, delete/restore, clock-skew, and fault-injection suites pass. |
| Browser sync boundary | Browser keys are non-extractable and content is encrypted before transport. | Same-origin code running after unlock can use the key and read or alter plaintext state. | This is an architectural boundary, not a bug to claim away; keep it disclosed. |
| SDK 2 isolation | Installable schema/SDK 2 packages are signed; logic uses workers, UI uses sandboxed iframes, and host calls are capability-scoped and bounded. | A valid signature proves package integrity, not identity or safety. Renderer reload/re-enable capability continuity has a known lifecycle defect. | Reload, crash, re-enable, update, rollback, uninstall, and multi-window lifecycle suite passes. |
| Extension marketplace | The public catalog is pull-request reviewed; desktop pins catalog metadata, hash, publisher key, signed manifest, and capabilities before install. NeoAnki TTS 2.0.1 is the first production listing. | Review is not a warranty, identity attestation, or learning-effectiveness claim; browser/mobile are browse-only. | NeoAnki TTS passes catalog validation, signed release provenance checks, and the extension's cross-platform desktop journey; core install/update/rollback coverage remains green. |
| Mobile | The source tree contains an Expo client using SQLite, SecureStore, Workspace v4, FSRS, and encrypted-sync packages. | Export/type checks are not real-device, accessibility, background-lifecycle, storage-pressure, or app-store evidence. | Physical-device matrix and publication checklist pass. |
| Diagnostics | Structured diagnostics apply bounds and redaction to common sensitive patterns. | Redaction is defense-in-depth and cannot guarantee that every user-authored secret or identifier is removed. | User preview plus expanded adversarial corpus and packaged export review. |
| Platform releases | v0.1.5 has macOS universal, Windows x64, and Linux x64 artifacts with checksums, SBOMs, and GitHub attestations. Future tag automation requires Developer ID/notarization and Authenticode for macOS/Windows. | v0.1.5 macOS and Windows artifacts are unsigned. A future workflow gate does not retroactively sign an existing release. | Published tag passes signing, trust assessment, packaged launch, checksum, SBOM, and attestation verification. |
| Better UX or learning | Individual design choices may be explained without claiming superiority or improved outcomes. | No comparative UX or learning-effectiveness study exists. | Predefined comparative study passes. |
| Anki replacement | Neo Anki is not yet a drop-in Anki replacement. | Compatibility, durability, sync, performance, accessibility, mobile, and UX gates remain open. | Every persona, migration/exit, durability, multi-device, platform, accessibility, and comparative gate passes. |

## Release review

Before a public tag, the release owner must compare website copy, README, release notes, marketplace wording, and this register with:

- `docs/audits/neo-anki-comprehensive-audit-2026-07-19.md`;
- the current remediation ledger and dependency risk register;
- `docs/anki-compatibility.md`;
- `docs/mobile-release-checklist.md`; and
- the actual artifacts and checks that completed for that tag.

Claims must describe the published artifact, not merely the newer `main` branch. If evidence is red, skipped, unavailable, or narrower than the claim, weaken or remove the claim before release.
