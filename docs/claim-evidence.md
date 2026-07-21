# Public claim evidence register

Every public claim must remain weaker than its current evidence. A passing unit test proves only its exercised case; presentation quality, an implemented primitive, or a planned release gate is not evidence that an end-to-end property holds.

Status below is aligned with the July 19 comprehensive audit, its remediation ledger, and the July 21 new-user journey audit. Neo Anki 0.4.2 starts with an empty workspace, adds recoverable loading, moves extensions into a dedicated hub, and introduces additive SDK appearance and authoring contracts without broadening the compatibility, sync, mobile, or learning-effectiveness claims below.

| Area | Allowed public wording | Known limit that must remain disclosed | Gate for stronger wording |
| --- | --- | --- | --- |
| Daily planning | Neo Anki uses FSRS state, a daily time budget, and a seven-day heuristic to estimate a study plan. | Forecasted reinforcement cost is heuristic and is not evidence of improved retention, completion, or fatigue. | Calibrated forecast study on representative, opt-in/local datasets. |
| Anki import | `.apkg`/`.colpkg` imports use bounded preflight, stable source identity, scoped replacement, and the pinned fixtures listed in the compatibility contract. | The 64 MiB supported boundary and pinned corpus do not prove arbitrary collection or unknown-field export fidelity. | Broader versioned corpus, bounded-memory stress, and pinned round-trip oracles pass. |
| Persistence and backups | Desktop stores canonical Workspace v4 in SQLite, serializes saves, creates recovery backups, and retains migration rollback files. | Passing rapid-save, rich round-trip, fault, recovery, and restart regressions cannot guarantee survival of arbitrary hardware, filesystem, or operating-system failure. | Clean-machine destructive fault and long-running recovery drills pass across supported platforms. |
| Review history | Review and undo use idempotent Workspace v4 commands; undo appends a reversal and sync orders events deterministically. | The exercised local and replica cases do not establish convergence under every long-offline or adversarial multi-client history. | Large multi-client reversal/convergence and fault-injection suites pass. |
| Encrypted sync | Clients encrypt and sign bounded workspace/media operations before sending them to the relay; chunk, page, replay, restore, and clock-skew regressions pass. | E2EE and protocol regressions do not establish hosted reliability or convergence under arbitrary faults and real deployment scale. | 100k-operation, adversarial offline-conflict, storage-pressure, and hosted fault-injection suites pass. |
| Browser sync boundary | Browser keys are non-extractable and content is encrypted before transport. | Same-origin code running after unlock can use the key and read or alter plaintext state. | This is an architectural boundary, not a bug to claim away; keep it disclosed. |
| SDK 2 isolation | Installable schema/SDK 2 packages are signed; logic uses workers, UI uses sandboxed iframes, host calls are capability-scoped and bounded, and lifecycle regressions cover revocation/recovery. | A valid signature proves package integrity, not identity or safety; automated lifecycle coverage is not a proof of complete containment. | Adversarial multi-window, crash-loop, and packaged-runtime security review remains green. |
| Extension marketplace | The public catalog is pull-request reviewed; desktop pins catalog metadata, hash, publisher key, signed manifest, and permissions before install. Nine first-party extensions are independently released and installable. | Review is not a warranty, identity attestation, or learning-effectiveness claim; browser/mobile are browse-only. Collection Insights summarizes the current collection and does not estimate mastery. | Listed packages pass catalog validation and signed-release provenance checks; install, update, and rollback coverage remains green. |
| Mobile | The source tree contains an Expo client using SQLite, SecureStore, Workspace v4, FSRS, and encrypted-sync packages. | Export/type checks are not real-device, accessibility, background-lifecycle, storage-pressure, or app-store evidence. | Physical-device matrix and publication checklist pass. |
| Diagnostics | Structured diagnostics apply bounds and redaction to common sensitive patterns. | Redaction is defense-in-depth and cannot guarantee that every user-authored secret or identifier is removed. | User preview plus expanded adversarial corpus and packaged export review. |
| Platform releases | Desktop tags build macOS universal, Windows x64, and Linux x64 artifacts with checksums, SBOMs, GitHub attestations, and packaged acceptance checks. macOS is ad-hoc signed and signature-verified. | Ad-hoc signing does not establish publisher identity or satisfy Gatekeeper; macOS and Windows users must verify checksums and GitHub attestations and follow the documented OS warning flow. | Developer ID notarization and Authenticode signing remain future trust improvements. |
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
