# Anki compatibility contract

Neo Anki treats Anki migration as a data-preservation operation, not a content scraper. Compatibility is implemented through the versioned Workspace v4 graph; the simpler Neo study model is a derived projection and is never the durable authority.

## Supported migration surface

Neo Anki preflights `.apkg` as an additive graph import and `.colpkg` as a profile replacement. A commit is refused when the package cannot be decoded safely or when an unsupported transformation has not been accepted explicitly.

For supported current and legacy packages, Neo Anki preserves:

- note IDs/GUID source identity, named fields, note types, templates, CSS, template ordinals, cloze ordinals and multiple cards per note;
- deck hierarchy, card-level decks, presets, tags, marks, flags, suspension, user/sibling bury state and filtered-deck source state;
- Anki scheduling state, exact due eligibility, native FSRS memory state where present, learning/relearning settings and immutable review history;
- media bytes, names, MIME type, hashes and source-package mappings;
- bounded unknown source metadata as inert data for rollback and round-trip export.

Unknown metadata is never executed. Anki Python add-ons are not compatible and are not loaded by Neo Anki.

## Import guarantees

- The archive is incrementally decoded in a cancellable bounded worker. Compressed size, expanded size, entry count, per-file size, compression ratio, database size, total media and execution time are limited and rechecked while entry chunks arrive.
- Every disposition is reported before commit as preserved, transformed, reset, unsupported or refused. Silent loss is a test and release failure.
- All IDs are remapped as one graph, then semantic invariants are checked before the live workspace changes.
- `.apkg` repeat imports use deterministic source identity. `.colpkg` never silently merges into an existing collection.
- The source package is durably flushed to a verified temporary file and atomically activated; a partial/corrupt prior copy is quarantined and repaired. A separately verified pre-import checkpoint is retained outside rotating daily backups. Settings lists both file types and removes only the exact file the user explicitly confirms after migration and exit-export verification.

## Scheduling continuity

Imported due eligibility remains authoritative until the first compatible transition. Native Anki FSRS memory state is used when available. Other supported histories are replayed through the pinned conversion routine, while the source due instant remains a continuity override. The migration preflight reports projected due workload before commit.

Neo-native reviews use four ratings: Again, Hard, Good and Easy. Learning and relearning cards are never shown before their exact due instant unless the user starts an explicit custom-study session.

## Exit safety

Neo Anki exports `.apkg` and `.colpkg` with supported content, templates, CSS, media, decks, scheduling state and review history. CI imports the generated package into pinned Anki 25.9.4 and compares graph counts, representative rendering, due state, review history and media hashes. A Neo-native backup remains available separately for complete recovery.

## Explicit limitations

- Anki add-on executable code and add-on-specific workflows are not emulated. Bounded opaque metadata may round-trip, but it has no behavior inside Neo Anki.
- A template feature that cannot be preserved inertly or rendered safely must be reported or refused; it must not be flattened silently.
- Compatibility with a future Anki schema is not implied until its fixture and round-trip oracle are added.
- Public replacement claims remain disabled until signed release artifacts, packaged cross-platform journeys, multi-device client runtime tests and the separate UX-superiority study pass.

## Evidence

The generated corpus and malformed-package fixtures live in `test-fixtures/anki/`. Import fidelity, scheduling, rendering, rollback-file durability and round-trip behavior are exercised by `src/lib/anki-corpus.test.ts`, `src/lib/anki.test.ts`, `electron/workspace-store.test.ts`, `src/lib/card-rendering.test.ts`, and `scripts/anki-oracle.py`. The current claim gate is tracked in `docs/claim-evidence.md`.
