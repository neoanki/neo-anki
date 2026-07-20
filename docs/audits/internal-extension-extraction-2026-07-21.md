# Internal extension extraction audit — 2026-07-21

## Outcome

The bundled-module inventory contained eight entries. Card Timer could move without changing its authority model. Memory Insights could move after narrowing its surface to facts available through the read-only `content:read` projection; historical review analytics were not carried into the package because SDK 2 deliberately does not expose review history. Their source, releases, signing keys, CI, and ownership moved to dedicated repositories and their renderer-compiled implementations were deleted from core.

| Former bundled module | Result | Repository / next stable seam |
| --- | --- | --- |
| Card Timer | Extracted and marketplace-listed | [`neoanki/neoanki-card-timer`](https://github.com/neoanki/neoanki-card-timer) · `config:sync`, `ui:settings`, `ui:review` |
| Memory Insights | Extracted and marketplace-listed with a narrower read-only collection view | [`neoanki/neoanki-insights`](https://github.com/neoanki/neoanki-insights) · `content:read`, `ui:page`; add a privacy-reviewed aggregate-history API before restoring historical recall charts |
| Prompt Types | Keep temporarily | Add a versioned `study:prompt-types` contribution with bounded create/render/compare DTOs and async failure fallback. Keep only the basic forward card in core. |
| Image Occlusion | Keep temporarily | Add `ui:authoring`, scoped media reads, keyboard-operable geometry events, and a review-presentation DTO. The extension must never receive the host DOM or an unrestricted workspace. |
| Anki & CSV Interoperability | Keep as core migration authority for now | Separate file parsing into packages, then add a staged `content:migrate` broker: extension parses, core validates full Workspace v4 invariants, creates a checkpoint, presents preflight, and commits atomically. Raw workspace replacement must not become a general extension capability. |
| Recovery Policies | Keep temporarily | Add manifest-declared `study:queue-policies` and bounded card scoring requests. Scores need due time, estimated duration, lapses, difficulty, and cancellation; core keeps eligibility and budget invariants. |
| Goals & Saved Views | Keep temporarily | Add `ui:workspace`; migrate legacy client-state arrays to extension-owned config/records; expose library deep links rather than passing the Library component or full `AppData`. Planning urgency can continue through `study:signals`. |
| Shared Packs | Keep temporarily | Define signed pack provenance, strict schemas, extension-owned note/card creation, conflict DTOs, and `ui:workspace`. Core must retain invariant checks, transactional commits, and scheduling preservation. |

“Keep temporarily” is not a reason to add new behavior to the internal registry. Each row names the smallest public contract required to finish extraction without replacing isolation with full-trust imports.

## Core boundary after extraction

Core continues to own Workspace v4 validation and persistence, scheduling eligibility and review transactions, media integrity, backup/recovery, sync conflict application, extension signature/lifecycle enforcement, and migration commits. These are invariants or authority boundaries rather than optional product features.

The internal registry remains an implementation-only migration scaffold for six core features and is no longer exposed in the Extensions manager. New optional features must target SDK 2 (or an intentionally versioned successor) and must not be added to `bundledModules`.

## Additional candidates

| Candidate | Recommendation | Reason / prerequisite |
| --- | --- | --- |
| Appearance packs and review decorations | Extract next | Can fit sandboxed UI and synchronized config; require semantic theme tokens and reduced-motion rules. |
| Alternative queue policies | Extract with Recovery Policies | High optionality and low data authority once the scoring DTO exists. |
| OCR, PDF extraction, web clipping | Extension-only | Optional heavyweight parsing/network dependencies should not enter core; use media creation plus owner-scoped patches. |
| External knowledge connectors | Extension-only | Network destinations, credentials, and privacy disclosures belong in reviewed manifests. |
| Optional import/export formats | Extension-only after migration broker | Parsing dependencies can release independently while core retains preflight and atomic commit authority. |
| Scheduler implementations | Postpone | A scheduler controls durable intervals and review transitions. Extract only after a conformance suite and versioned state-transition ABI exist. |
| Sync transports | Do not extract yet | Encryption, replay/conflict rules, cancellation, and credential handling are core data-safety boundaries. |
| Backup, recovery, update, marketplace, extension manager | Keep in core | They are recovery or trust roots needed even when every optional package is disabled. |

## Release and marketplace evidence

- Both repositories are public, MIT-licensed, independently versioned, and protected by repository-scoped Ed25519 signing secrets.
- Release workflows stamp the exact extension and NeoAnki commits, rebuild twice, compare SHA-256, attest build provenance, and publish immutable GitHub Release assets.
- The marketplace catalog pins the package URL, digest, publisher key, minimum app version, and exact permissions. Its validator downloads and inspects every package before approval.
- The extraction uncovered a ZIP timestamp portability defect: the old canonical archive used a UTC instant for timezone-less DOS fields, so a package built in UTC could fail signature reconstruction elsewhere. The package writer now emits local wall-clock midnight, a cross-timezone byte-equality regression covers UTC and Europe/Kyiv, and the exact marketplace assets for Card Timer, Memory Insights, and TTS stage successfully through the desktop signature verifier.
