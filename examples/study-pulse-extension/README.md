# Study Pulse extension example

This deliberately small extension proves the SDK v2 boundary: independently authored logic runs in a module worker, its page runs in a sandboxed iframe, and each receives only a scoped study DTO. The package is deterministic and signed with a clearly non-production development key included solely for this example.

From the repository root:

```bash
npm run extension:example
```

Install the generated package from Neo Anki Settings → Extensions → Install from file.

Real publishers must keep their Ed25519 private key outside the source tree and provide it through `NEO_ANKI_EXTENSION_SIGNING_KEY`. Neo Anki verifies the signature and reviewed publisher key before installation.
