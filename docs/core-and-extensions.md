# Neo Anki core and extension boundary

Neo Anki has two deliberately different trust tiers. Code compiled into the application is trusted core code. Installable SDK 2 packages are designed to run behind worker/iframe isolation and may use only reviewed, capability-scoped host calls. The UI must not imply that these tiers have identical authority.

This page describes the intended boundary and implemented checks, not a proof that every lifecycle path is complete. The July 19 audit's renderer reload and disable/re-enable findings were remediated with instance-bound ownership, revocation, and lifecycle regressions before v0.2.1.

## Trusted core

The kernel is intended to own the invariants whose failure could corrupt a workspace or make the capture → schedule → review loop unavailable:

- Workspace v4 entities, validation, migration commits, persistence, media integrity, and backup/restore.
- Scheduling strategies, review/reversal events, due eligibility and daily planning.
- The Today, Library, Create, Review, sync, recovery and Settings shells plus typed extension mounting surfaces.
- Extension package review, signatures, lifecycle recovery, capability issuance, bounded host services and safe mode.
- Encrypted sync protocol application, conflict presentation and explicit resolution.

There is no internal optional-feature registry. More Card Types, Image Occlusion, Anki & CSV Import/Export, Review Priorities, Goals & Saved Searches, Learning Packs, Collection Insights, Card Timer, and Text to Speech all ship as independently released, signed SDK 2 packages. The former Browser Tab Sync experiment was removed because whole-document last-writer merging could not preserve Workspace v4 deletion and graph invariants.

## Installable SDK 2 packages

SDK 2 is the only accepted contract for package distribution:

- Non-UI logic runs in a dedicated module worker. Desktop serves the exact reviewed worker entry through a same-origin gateway with `connect-src 'none'`; a lockdown prelude removes ambient network, storage, nested-worker and realtime browser APIs.
- Executable review, page, create, workspace, and migration UI runs in an iframe with `sandbox="allow-scripts"` and without `allow-same-origin`. Its CSP denies ambient network, forms, base URLs and parent DOM/CSS access.
- Configure is host-rendered from bounded declarative manifest data. It executes no extension code, has no command bridge, and limits settings to local validation plus synchronized config and device-secret persistence.
- Workers and frames receive minimal DTO projections instead of an application context. The explicitly high-authority `content:migrate` capability is the exception: it brokers a Workspace v4 export for local conversion and accepts a staged commit only after core validation, checkpoint creation, and atomic persistence.
- All useful effects cross typed message channels. The host rechecks the reviewed permission, extension identity, message size, queue size, timeout, cancellation and operation-specific limits.
- Content changes use owner-scoped `WorkspacePatchV2` operations with expected revisions. Core validates the resulting Workspace v4 graph before accepting a patch; broader workspace persistence still has separately documented atomicity gaps.
- Network requests are HTTPS-only, restricted to reviewed destinations, redirect-revalidated, streamed to a response cap and cancellable.
- Media is decoded/hashed and created by core. Secret batches are serialized per extension and stored only when the operating-system backend is secure.

SDK v2 packages are byte-reproducible and Ed25519-signed. Installation verifies that the signed digest, embedded publisher key and reviewed manifest agree. A signature proves possession of that key and package integrity; it does not by itself establish a publisher’s legal identity or trustworthiness. Marketplace discovery is implemented separately; real-world identity attestation and automatic updates remain postponed.

## Implemented SDK v2 checks

- Package paths, counts and compressed/expanded sizes are bounded before install; traversal and manifest/entry mismatches are rejected.
- Same-digest reinstall is idempotent. Update/downgrade activation uses a recoverable state transition and retains provenance/rollback information during review.
- Worker startup, messages, queues and contribution execution are bounded. Cancellation propagates to host operations.
- Executable UI frames cannot share the host origin, DOM, React tree, cookies or storage; Configure contains no extension frame.
- A capability token is bound to the enabled extension instance and exact reviewed permission; reload, disable/re-enable, update, rollback, uninstall, and renderer teardown revoke prior claims and token-owned network work.
- Patch ownership, expected revisions, operation count/size and the current workspace invariant set are checked before acceptance.
- Unknown or crashing prompt behavior still falls back to a basic reviewable card; extension failure is recorded without granting broader data access.
- The startup watchdog opens a package-free safe-mode window if installed code prevents renderer readiness.

See [extension-sdk.md](extension-sdk.md), [extension-authoring.md](extension-authoring.md) and the signed [`examples/study-pulse-extension`](../examples/study-pulse-extension).

## Still postponed

- Real-world publisher identity attestation, automatic extension updates and dependency resolution. Marketplace discovery verifies GitHub review provenance, pinned release metadata and publisher-key continuity, but does not claim legal identity verification.
- Executing Anki Python add-ons. Unknown add-on metadata may be retained inertly for round-trip safety but is never executed.
- AI extraction/grading, OCR/PDF pipelines, web clipping and external knowledge connectors.
- Collaboration, shared-account policy, decorative gamification and third-party scheduler strategies.
