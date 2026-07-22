# Neo Anki project guidance

## Git workflow

- By default, integrate completed and verified changes into `main` and push `main`.
- Prefer working directly on `main` when it is safe. If temporary isolation is useful, use a short-lived branch and merge or fast-forward it into `main` before delivery.
- Do not create or use branches whose names begin with `codex/`.
- Leave work on a separate branch only when the user explicitly requests that workflow or when `main` cannot be updated safely; explain the blocker clearly.
