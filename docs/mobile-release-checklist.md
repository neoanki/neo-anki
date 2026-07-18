# Mobile release checklist

Automated TypeScript checks and reproducible Android/iOS Expo exports are required, but they do not establish real-device accessibility, lifecycle, or recovery behavior. Complete this matrix for every public mobile binary. Record device/OS/build identifiers and attach evidence to the release.

## Automated prerequisites

- [ ] `npm run mobile:check`
- [ ] `npm run mobile:export`
- [ ] Workspace v4, scheduler, card-rendering, sync-protocol and sync-client suites are green on the same commit.
- [ ] No high or critical production dependency advisory is open; reviewed exceptions remain within expiry.

## Required device matrix

Exercise at least one current and one previous supported major OS release on a physical iPhone and Android phone. Include one small-screen device and one tablet or large-screen device across the matrix.

- [ ] Fresh install, onboarding and encrypted workspace creation
- [ ] Upgrade from the previous public version without data loss
- [ ] Create/edit/delete/restore notes and retain review history after restart
- [ ] Review with Again/Hard/Good/Easy, typed practice, sibling burying and immediate double-tap protection
- [ ] Background during a pending save and during sync, then resume
- [ ] Force-stop/process death during a pending save and during sync, then recover without stale overwrite
- [ ] Offline edits on two devices, reconnect, converge, and resolve a meaningful conflict
- [ ] Slow disk and slow/interrupted network produce visible, recoverable errors
- [ ] Screen reader: VoiceOver and TalkBack labels, order, headings, controls and grading announcements
- [ ] Largest supported font/display scaling without clipped controls or hidden content
- [ ] Reduce Motion, dark mode, high contrast and landscape orientation
- [ ] Keyboard/switch navigation where supported; touch targets remain at least 44 points
- [ ] Battery/thermal sanity during a 30-minute review and a large supported import/sync
- [ ] SecureStore credentials are unavailable after sign-out and workspace deletion

## Publication record

- Release/version:
- Commit:
- Tester/date:
- Devices and OS versions:
- Evidence links:
- Exceptions, owner and expiry:
- Approval:

Any unchecked required row blocks mobile-store publication. Desktop/browser publication may proceed only when release notes clearly state that no mobile-store binary is included.
