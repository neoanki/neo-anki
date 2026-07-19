# Anki compatibility contract

Neo Anki treats Anki migration as a preflighted conversion, not a claim of complete compatibility. The current implementation has useful coverage for pinned fixtures, but it is not yet a general-purpose, lossless Anki round trip. Keep the original package and a separate Neo Anki backup until you have inspected both the migrated collection and an exit export in Anki.

## Currently exercised surface

Neo Anki accepts `.apkg` and `.colpkg` files that pass archive, database, size, and semantic checks. The preflight classifies known transformations and warnings before the live workspace changes.

The pinned Anki 25.9.4 fixture corpus exercises current and legacy schemas across representative:

- named fields, note types, templates, CSS, card ordinals, cloze identity, and several prompt variants;
- decks, presets, tags, flags, suspension/bury state, due data, and review history;
- media names, bytes, MIME information, and source-package retention;
- Neo Anki `.apkg`/`.colpkg` export reopened by the pinned Anki oracle.

This is the tested matrix, not a promise that every add-on, template expression, scheduler edge case, unknown row, protobuf field, or future Anki schema is preserved and re-emitted.

## Import behavior

- Import runs in a cancellable worker and enforces compressed, expanded, entry-count, database, media, and execution limits.
- Known dispositions are reported before commit. A green preflight means the package passed the implemented checks; it is not proof of semantic equivalence with Anki.
- IDs from an exact package are deterministic. A modified or repacked export of the same Anki collection can receive a different package-derived identity and duplicate existing notes/cards.
- `.apkg` is additive. The current `.colpkg` replace path swaps the complete Workspace v4 document, so Neo Anki-only settings, goals, views, packs, Trash, and other workspace data may be replaced—not only the active profile.
- Desktop retains the chosen source package and a pre-import checkpoint for rollback. Retention helps recovery but does not make the conversion lossless.

## Scheduling continuity

The importer maps known due, interval, repetition, lapse, and FSRS state into Neo Anki scheduling fields. Source due data is retained where supported. Desktop, browser, and mobile do not yet have a completed differential suite proving identical transitions for every imported learning/relearning state, preset limit, timezone, and rating.

Neo-native reviews use Again, Hard, Good, and Easy. Do not assume that a migrated collection will produce the same future schedule as the source Anki version without comparing it on representative cards.

## Export and exit

Neo Anki can export supported content into `.apkg` and `.colpkg`, and CI reopens generated fixtures with pinned Anki 25.9.4. Export rebuilds a known Anki schema; unknown source metadata retained for rollback is not guaranteed to be re-emitted. Orphaned or unsupported records may be omitted or transformed.

For a cautious migration:

1. Keep the original Anki package outside Neo Anki.
2. Export a Neo Anki backup before and after import.
3. Inspect card variants, templates, media, due workload, flags/suspension, and representative review histories.
4. Export back to Anki and open the result with the Anki version you depend on.
5. Remove retained rollback files only after those checks pass.

## Resource limits

The archive decoder applies hard limits, but the current importer can still materialize the compressed file, expanded entries, database rows, media data URLs, and Workspace v4 entities in memory. Inputs within the nominal 512 MB compressed / 2 GB expanded ceilings can exceed practical memory. ZIP64 is unsupported, and very large entry lists or opaque records can exceed Workspace v4 envelope limits.

Treat large or mature collections as an unsupported stress case until bounded-memory benchmarks and rejection tests cover their actual shape.

## Explicitly unsupported or unproven

- Executing Anki Python add-ons or reproducing add-on workflows.
- Fidelity for arbitrary custom templates, unknown normalized/protobuf data, or future Anki schemas.
- Update-in-place behavior for modified, schedule-changed, media-changed, or repacked repeat imports.
- Lossless `.colpkg` profile replacement that preserves unrelated Neo Anki workspace state.
- Bounded-memory import at the published archive ceilings.
- General scheduling parity across Anki versions and all Neo Anki clients.
- A drop-in replacement or UX-superiority claim.

## Evidence and status

Fixtures and malformed packages live in `test-fixtures/anki/`. Relevant checks include `src/lib/anki-corpus.test.ts`, `src/lib/anki.test.ts`, `electron/workspace-store.test.ts`, `src/lib/card-rendering.test.ts`, and `scripts/anki-oracle.py`. CI installs pinned Anki 25.9.4; local runs can skip oracle work when Anki is unavailable.

Known gaps and their release gates are tracked in `docs/claim-evidence.md` and `docs/audits/neo-anki-comprehensive-audit-2026-07-19.md`.
