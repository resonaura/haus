# NVR test ownership — 2026-11-06

P14.2.3.3.2.3.1 is verified. Shared native/media tests, runtime/integration tools and Node packaging retirement remain open.

## Changed

- Nine remaining Node domain suites now live in strict TypeScript under `apps/hub/test/nvr/{camera,storage,playback}` and `packages/media/test/{camera,recording}`. Hub owns authentication, blob verification/settings, playback preparation, camera leases/policies/access and durable recording outboxes. Media owns source validation and ring clocks, coverage, jitter and storage reservation integration. The nine old MJS entrypoints are removed; fixtures are split into small owner-local support files.
- An AST inventory maps all 42 original top-level definitions. The nested growth wrapper had no separate assertions; its successful-growth and exhausted-storage children are now independently registered cases. That produces 43 migrated runtime cases plus two new viewer regressions. All original assertions remain: 251 equal, 35 deepEqual, 25 rejects, 13 ok, four throws and one notEqual. Migrated test bodies add three ok assertions and public completion polling adds one notEqual assertion; shared helpers also validate required values.
- Typechecking includes media source and tests; its production build still includes only source. Camera session contracts are separate from logic, preserve existing exports and express the ring/recordings methods actually consumed. The DNS resolver port now describes its existing `all: true` call without an overloaded-function assertion. HMAC authentication consumes only method, URL and headers. Blob readers expose a read-only active-digest count instead of exposing their mutable lease map.
- Playback tests observe authenticated completion/status and cleanup rather than private jobs or replacing a readonly encoder. Camera access tests now use the actual CameraSessions service. Activity/continuity restoration waits for observable detector/session state rather than protected busy flags. The shared session fixture keeps simulated media fresh while virtual lease time advances; expiry still removes unowned producers.

## Reproduced regression

Native media viewers store `session: { id }`, while older adapters can store a session string. Candidate and viewer-close HTTP handlers compared that value directly to the session ID, returning 404 for an otherwise owned native viewer. A signed local HTTP test failed for the native shape while the string case passed before the fix.

A shared viewer-session ID helper now normalizes both representations in candidate/close, release and expiry paths. Both shapes accept owned candidates and close requests. A viewer referencing another session is rejected with 404 and remains unchanged; no candidate is forwarded. Pairing, ownership checks and wire formats are preserved.

## Observed checks

- PASS — `pnpm --filter @haus/hub typecheck` and `pnpm --filter @haus/media typecheck`, exit 0. The first strict checks identified incomplete mocks, optional values and protected-state access; those were corrected without suppressions or weaker compiler settings.
- PASS — `pnpm --filter @haus/hub exec vitest run test/nvr/camera test/nvr/storage test/nvr/playback`: 11 files, 42 tests. Includes existing neighboring tests and the two new string/native viewer cases.
- PASS — `pnpm exec vitest run packages/media/test`: 11 files, 30 tests, no skips. The jitter case generates local synthetic video/audio with FFmpeg, probes the completed clip, rejects a real missing segment and preserves an earlier original.
- PASS — focused `pnpm exec oxlint --deny-warnings` over affected NVR/media source and tests; `pnpm architecture:check` (421 source files); `git diff --check`.
- PASS — `pnpm check`, exit 0 after the final source/test edits: workspace typechecks, lint, rules/licenses, formatting, builds; root 278 files/1473 tests; Kitsune 18/18, HomeKit 21/21; remaining Node 24 passed/10 environment skips; local integration two passed/one provisioned-container skip; Hub 56 files/295 tests.

The initial migrated session test failed because the newly typed fixture had a fixed freshness timestamp while its virtual clock advanced by 61 seconds. Keeping simulated arriving media fresh restores the original lease/rotation scenario without changing production expiry or assertions. The viewer regression separately reproduced a production HTTP-path bug and remains covered after the fix.

## Limits and continuation

All verification uses disposable local databases/files, synthetic media and loopback HTTP. No physical camera, radio, production node, household archive, HA instance or deployment was touched. Native Linux/container and real-device acceptance are separate evidence. P16.1 authentication/standalone composition gaps remain a release blocker.

Continue P14.2.3.3.2.3.2 with shared native IPC/WebRTC/RTP, FFmpeg and RTSP-peer test migration, then runtime/integration/tools and packaging retirement. The active goal and hourly automation remain in effect without subagents. Commit/push waits for verified completion of the agreed plan; branches remain unchanged.
