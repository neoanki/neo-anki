# Internal extension extraction audit — 2026-07-21

## Outcome

The bundled-module inventory contained eight entries. All eight now live in dedicated public repositories, use the same signed SDK 2 package boundary as third-party extensions, and are marketplace-listed. Their renderer-compiled implementations and the internal registry were deleted from core.

| Former bundled module | Result | Repository / next stable seam |
| --- | --- | --- |
| Card Timer | Extracted and marketplace-listed | [`neoanki/neoanki-card-timer`](https://github.com/neoanki/neoanki-card-timer) · `config:sync`, `ui:settings`, `ui:review` |
| Collection Insights | Extracted and marketplace-listed with a narrower read-only collection view | [`neoanki/neoanki-insights`](https://github.com/neoanki/neoanki-insights) · `content:read`, `ui:page`; add a privacy-reviewed aggregate-history API before restoring historical recall charts |
| More Card Types | Extracted and marketplace-listed | [`neoanki/neoanki-prompt-types`](https://github.com/neoanki/neoanki-prompt-types) · manifest-declared `study:prompt-types`; core keeps only the basic forward fallback |
| Image Occlusion | Extracted and marketplace-listed | [`neoanki/neoanki-image-occlusion`](https://github.com/neoanki/neoanki-image-occlusion) · `study:prompt-types`, `ui:create`; opaque-origin, keyboard-operable authoring UI |
| Anki & CSV Import/Export | Extracted; commit authority remains core | [`neoanki/neoanki-interoperability`](https://github.com/neoanki/neoanki-interoperability) · `content:migrate`, `ui:migration`; core validates, checkpoints, and atomically commits |
| Review Priorities | Extracted and marketplace-listed | [`neoanki/neoanki-recovery-policies`](https://github.com/neoanki/neoanki-recovery-policies) · bounded `study:queue-policies`; core keeps eligibility and budget invariants |
| Goals & Saved Searches | Extracted and marketplace-listed | [`neoanki/neoanki-workspace`](https://github.com/neoanki/neoanki-workspace) · `study:signals`, `config:sync`, `ui:workspace` |
| Learning Packs | Extracted and marketplace-listed | [`neoanki/neoanki-shared-packs`](https://github.com/neoanki/neoanki-shared-packs) · strict pack schemas, owner-scoped atomic patches, field-level three-way merge, preserved conflicts, `ui:workspace` |

Each extracted repository preserves subtree history from its former core directory, has repository-scoped signing credentials, and releases independently from the host.

## Core boundary after extraction

Core continues to own Workspace v4 validation and persistence, scheduling eligibility and review transactions, media integrity, backup/recovery, sync conflict application, extension signature/lifecycle enforcement, and migration commits. These are invariants or authority boundaries rather than optional product features.

The internal registry no longer exists. New optional features must target SDK 2 (or an intentionally versioned successor); core accepts only generic contribution contracts and invariant-preserving host services.

## Additional candidates

| Candidate | Recommendation | Reason / prerequisite |
| --- | --- | --- |
| Appearance packs and review decorations | Extract next | Can fit sandboxed UI and synchronized config; require semantic theme tokens and reduced-motion rules. |
| Alternative queue policies | Extract with Review Priorities | High optionality and low data authority once the scoring DTO exists. |
| OCR, PDF extraction, web clipping | Extension-only | Optional heavyweight parsing/network dependencies should not enter core; use media creation plus owner-scoped patches. |
| External knowledge connectors | Extension-only | Network destinations, credentials, and privacy disclosures belong in reviewed manifests. |
| Optional import/export formats | Extension-only after migration broker | Parsing dependencies can release independently while core retains preflight and atomic commit authority. |
| Scheduler implementations | Postpone | A scheduler controls durable intervals and review transitions. Extract only after a conformance suite and versioned state-transition ABI exist. |
| Sync transports | Do not extract yet | Encryption, replay/conflict rules, cancellation, and credential handling are core data-safety boundaries. |
| Backup, recovery, update, marketplace, extension manager | Keep in core | They are recovery or trust roots needed even when every optional package is disabled. |

## Release and marketplace evidence

- All eight extracted repositories are public, MIT-licensed, independently versioned, and protected by repository-scoped Ed25519 signing secrets.
- Release workflows stamp the exact extension and NeoAnki commits, rebuild twice, compare SHA-256, attest build provenance, and publish immutable GitHub Release assets.
- The marketplace catalog pins the package URL, digest, publisher key, minimum app version, and exact permissions. Its validator downloads and inspects every package before approval.
- The extraction uncovered a ZIP timestamp portability defect and a browser-only SQLite compatibility branch. Canonical archives now rebuild byte-identically across UTC and Europe/Kyiv, while the SDK compiler replaces dead Node filesystem/crypto branches with explicit browser sandbox shims rather than exposing Node access.
