# Neo Anki core and extension boundary

Neo Anki has two deliberately different trust tiers. Code compiled into the application is trusted core code. Installable SDK 2 packages run behind worker/iframe isolation and may use only reviewed, capability-scoped host calls. The UI must not imply that these tiers have identical authority.

## Trusted core and bundled feature modules

The kernel owns the invariants whose failure could corrupt a workspace or make the capture → schedule → review loop unavailable:

- Workspace v4 entities, validation, migration, transactional persistence, media integrity, backup/restore and interoperable import/export.
- Scheduling strategies, append-only review/reversal events, exact due eligibility, daily planning and the atomic review transaction.
- The Today, Library, Create, Review, migration, sync, recovery and Settings surfaces.
- Extension package review, signatures, lifecycle recovery, capability issuance, bounded host services and safe mode.
- Encrypted sync protocol application, conflict presentation and explicit resolution.

Feature modules under `src/extensions/`—Prompt Types, Image Occlusion, Interoperability, Recovery Policies, Goals & Saved Views, Shared Packs, Insights and Card Timer—are compiled with the app and are therefore trusted. Their internal `CoreModuleManifest`/`NeoAnkiCoreModule` registry supports modularity and failure fallbacks, but it is not an extension SDK or a security boundary. The former Browser Tab Sync experiment was removed because whole-document last-writer merging could not preserve Workspace v4 deletion and graph invariants.

## Installable SDK 2 packages

SDK 2 is the only contract for package distribution:

- Non-UI logic runs in a dedicated module worker. Desktop serves the exact reviewed worker entry through a same-origin gateway with `connect-src 'none'`; a lockdown prelude removes ambient network, storage, nested-worker and realtime browser APIs.
- UI runs in an iframe with `sandbox="allow-scripts"` and without `allow-same-origin`. Its CSP denies ambient network, forms, base URLs and parent DOM/CSS access.
- Workers and frames receive minimal DTO projections instead of an entire workspace or application context.
- All useful effects cross typed message channels. The host rechecks the reviewed permission, extension identity, message size, queue size, timeout, cancellation and operation-specific limits.
- Content changes use owner-scoped `WorkspacePatchV2` operations with expected revisions. Core validates the complete resulting Workspace v4 graph and commits atomically or rejects the whole patch.
- Network requests are HTTPS-only, restricted to reviewed destinations, redirect-revalidated, streamed to a response cap and cancellable.
- Media is decoded/hashed and created by core. Secret batches are serialized per extension and stored only when the operating-system backend is secure.

SDK v2 packages are byte-reproducible and Ed25519-signed. Installation verifies that the signed digest, embedded publisher key and reviewed manifest agree. A signature proves possession of that key and package integrity; it does not by itself establish a publisher’s legal identity or trustworthiness. Marketplace identity, discovery and automatic update policy remain separate future work.

## Enforced SDK v2 invariants

- Package paths, counts and compressed/expanded sizes are bounded before install; traversal and manifest/entry mismatches are rejected.
- Same-digest reinstall is idempotent. Update/downgrade activation uses a recoverable state transition and retains provenance/rollback information during review.
- Worker startup, messages, queues and contribution execution are bounded. Cancellation propagates to host operations.
- UI frames cannot share the host origin, DOM, React tree, cookies or storage.
- A capability token is bound to the enabled extension and exact reviewed permission.
- Patch ownership, expected revisions, operation count/size and the full workspace invariant set are checked before one atomic commit.
- Unknown or crashing prompt behavior still falls back to a basic reviewable card; extension failure is recorded without granting broader data access.
- The startup watchdog opens a package-free safe-mode window if installed code prevents renderer readiness.

See [extension-sdk.md](extension-sdk.md), [extension-authoring.md](extension-authoring.md) and the signed [`examples/study-pulse-extension`](../examples/study-pulse-extension).

## Still postponed

- Marketplace discovery, publisher identity attestation, automatic extension updates and dependency resolution.
- Executing Anki Python add-ons. Unknown add-on metadata may be retained inertly for round-trip safety but is never executed.
- AI extraction/grading, OCR/PDF pipelines, web clipping and external knowledge connectors.
- Collaboration, shared-account policy, decorative gamification and third-party scheduler strategies.
