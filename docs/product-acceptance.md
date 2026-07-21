# Product acceptance strategy

The executable commands, headless guarantees, native-mobile boundary, evidence contract, and defect lifecycle are defined in the [QA automation guide](qa-automation.md).

Neo Anki is accepted from the outside in. Unit, component, and source-build tests are necessary, but they do not establish that a downloaded application is usable.

## Why the previous audit missed user-visible failures

| Escaped issue | What the old checks proved | Missing product evidence |
| --- | --- | --- |
| Marketplace buried in Settings | The manager component rendered and its bridge calls were mocked. | A first-time user could discover, inspect, install, and return from the marketplace. |
| Extension configuration used inconsistent styles and later clipped controls | Individual extension DOM and theme helpers passed. Screenshots covered the visible top of a frame. | The signed package inside the packaged host at every target width, including the bottom-most control and exactly one usable scroll surface. |
| TTS generation was unavailable from authoring | TTS generation worked after tests injected a configured profile and credential. | The zero-configuration state explained the prerequisite and provided an in-context route to satisfy it without losing the draft. |
| Core authoring mentioned cloze without the extension | Tests normally started from demo data that already contained several prompt variants. | A blank production workspace with no optional extensions. |
| Fresh installs contained examples | Demo fixtures and production initialization shared one factory. | Durable database counts from a new application profile before and after onboarding. |
| Gatekeeper blocked the downloaded app | CI launched its own unsigned build in the runner workspace. | The downloaded, quarantined distribution on a clean supported Mac, including notarization assessment. |
| Marketplace install did nothing or required a manual reload | Command-line package installation and mocked manager actions passed. | Clicking the public catalog's Install action in the released app, waiting through reload, and checking restored route and data. |
| Import from Anki still opened marketplace after installation | The absent-extension deep link and the importer surface were tested separately. | The same action before installation, after installation, and after restart. |
| Authoring draft disappeared during extension setup/reload | In-memory route changes retained React module state. | A real renderer reload and restart while a partially completed draft exists. |

The common cause was implementation-shaped coverage: tests knew which component or command to call, seeded the state needed by the implementation, and rarely observed the complete released journey.

## Required verification layers

1. **Contract tests** validate data, storage, SDK, scheduling, migration, and security invariants.
2. **Source-build journeys** provide fast browser and Electron feedback across supported engines.
3. **Packaged-core acceptance** launches the produced executable with a new disposable profile, completes onboarding, creates and reviews knowledge, restarts, resets, and inspects durable counts.
4. **Signed-extension acceptance** installs immutable release packages through the public catalog, exercises absent/configured/disabled/error states, reloads, restarts, and verifies saved workspace state.
5. **Exploratory visual acceptance** captures what a user sees at 375, 768, and 1440 pixels in both themes, plus 200% text and reduced motion. The reviewer must inspect the complete page, not only the initial viewport.
6. **Distribution acceptance** downloads the public artifact as a user would and checks operating-system trust, launch, upgrade, uninstall, and retained data.

A lower layer cannot waive a higher one. In particular, a green source checkout cannot approve a packaged release.

## State matrix

Every release must cover these states with a new profile unless the row explicitly tests persistence:

| Surface | Required states |
| --- | --- |
| Onboarding | First launch, Fresh, backup restore validation, completion, restart |
| Today | No knowledge, work available, caught up, session filters exclude work |
| Authoring | Empty, meaningful input, validation failure, success, persistence failure, extension action unavailable/running/failed/retried |
| Library | No data, no filter results, populated, suspended, buried, edit, trash/restore |
| Review | Prompt, answer, edit/resume, renderer failure, completion, restart/process restoration |
| Extensions | Catalog loading/error, absent, installing, installed, configurable, disabled, update/rollback, uninstall with both credential choices |
| Import | Extension absent, installed, cancel, successful import, partial failure/retry, return to imported collection |
| TTS | No provider, realtime-only track, configured generated track, synthesis progress/cancel/failure/retry, playback, duplicate prevention, disabled extension |

## Black-box rules

- Every automated browser, Electron, packaged-artifact, extension and native E2E run is headless. Playwright configurations set `headless: true`; Electron launches set `NEO_ANKI_E2E_HEADLESS=1`; native simulators run without opening their UI. Physical-device accessibility and hardware checks are the only manual exception.
- The test subject is the packaged executable and exact signed package bytes intended for publication.
- Each scenario gets a unique temporary application-data directory. Tests never depend on the developer's profile.
- Start with no database, local storage, extension state, credentials, or service-worker cache.
- Assert user-visible outcomes and durable workspace state after reload and process restart.
- Fail on uncaught page errors, unexpected error-level console messages, extension diagnostics, or silent fallback rendering.
- Preserve traces and full-page screenshots on failure. Key acceptance screens are captured on success for human inspection.
- Packaged tests on a developer workstation never write or decrypt credentials: Electron Safe Storage is application-name global on macOS and can trigger login-Keychain prompts across disposable profiles. Provider/credential tests use the non-packaged test host with its explicitly gated disposable secret protector, or a clean ephemeral CI keychain. The disposable protector is rejected by packaged applications.
- Provider mocks may replace the remote billing endpoint in that isolated environment, but not the host, extension worker, iframe, storage, capability broker, or package installation path.
- A flow is not complete until it has a recovery path and the user can reach the next truthful destination.

## Release gates

A release is stopped when any of the following is true:

- the packaged journey was skipped;
- an acceptance test used demo data for a clean-install assertion;
- a required control is clipped, unreachable by keyboard, or hidden at a target width;
- a reload or restart loses a draft, workspace mutation, route needed to finish the flow, or credential-choice result;
- the public catalog installs bytes other than the reviewed immutable package;
- a supported operating system rejects the public artifact under its normal trust policy;
- screenshots or traces were not retained for a failed packaged test.

The CI release entry point is `npm run test:acceptance:release`. Set `NEO_ANKI_RELEASE_APP` to the packaged executable and `NEO_ANKI_RELEASE_TTS_PACKAGE` to the exact signed TTS package to include the cross-repository authoring test.

Installed public-catalog verification is deliberately separate: run `npm run test:acceptance:released-extensions` only with an explicit `NEO_ANKI_RELEASED_APP`. Responsive screenshot exploration uses `npm run test:audit:blackbox` with its explicit app/package inputs. These suites are excluded from the default Playwright configuration so a normal source test cannot launch a packaged app or access the user's Keychain by accident.
