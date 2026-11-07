# Hub runtime acceptance — 2026-11-06

P14.2.3.2 is verified. P14.2.3.3 and the wider P14/P16 work remain open.

## Changed behavior and paths

- `apps/hub/src/runtime` composes configuration, NVR resources, media, telemetry and explicit mDNS discovery. `src/main.ts` installs signal handlers before startup and awaits shutdown without forcing an early process exit. Partially initialized resources register cleanup before initialization awaits; cleanup is cached, ordered and aggregated.
- `src/app.module.ts` and `src/nest.ts` receive an explicit data directory. Both environment aliases must agree, avoiding accidental use of a second database root. Invalid key, origin, stream budget and listener configuration fail before resources are acquired.
- Installed instance IDs survive restart. Concurrent first starts publish one synced complete identity without replacing a winner; malformed existing IDs are preserved and fail closed. Directory syncing is used where supported (not Windows).
- Media engines receive the composition-root MediaRuntime. Optional encrypted camera-policy failures expose unavailable capabilities with stable diagnostics and close partial initialization. Late continuity acquisition is joined and its lease released before shutdown completes.
- Type checking exposed an existing native viewer mismatch: viewer.session is a session object, while CameraSessions cleanup compared a string. Release/expiry now support the native object shape and preserve another owner's lease. Detector stored events carry their guaranteed sequence in the public type.
- NVR transport gates late upgrades, aborts incomplete requests, stops resource users, drains requests and closes storage. The explicit external lifetime owner avoids duplicate teardown and keeps an earlier cleanup error from aborting unrelated Nest module destruction. Tests verify the Hub DataSource and listener close even when telemetry stop throws.
- `src/cli/telemetry.ts` and `src/runtime/collector.ts` publish bounded sanitized, synced atomic reports. Sampling is serial; stop joins pending samples/writes; failures preserve old reports and clean temporary files.
- `src/recovery` and `src/cli/recover.ts` retain authenticated export/listing behavior. Unknown kit values and ambiguous arguments are validated; redirects and unapproved HTTP are rejected. Blob hashing, bounded download, no overwrite, authenticated backup decryption and no automatic apply remain in place. CLI errors do not print kit secrets or private payloads.
- Removed `apps/node/lib/{bootstrap,main,node,mdns-advertisement,host-collector,recover}.mjs`; no Node runtime MJS implementation remains. Existing process, discovery and integration clients use compiled Hub exports. Package scripts, recovery/telemetry docs, the service template and interim NVR Docker command follow the new entrypoints. Docker consolidation and Node package/native/test retirement remain P14.2.3.3.

## Observed checks

All checks used disposable local files, databases, media and HTTP listeners. No household service, device, archive or deployment was operated.

- PASS — `pnpm check`, exit 0: workspace typechecks, lint, engineering/license rules, formatting, builds, root 236 files/1330 tests, Kitsune 18/18, HomeKit 21/21, Node 152 passed/10 skips, integration 2 passed/1 skip, Hub 45 files/256 tests. Root test discovery preceded the last upgrade assertion; the later Hub run includes it.
- PASS — `pnpm --filter @haus/hub exec vitest run test/runtime test/nvr test/nest/foundation.test.ts`, final rerun: 13 files/40 tests, including the last transport edit.
- PASS — `pnpm --filter @haus/hub typecheck` and `pnpm --filter @haus/hub build`.
- PASS — `pnpm --filter @haus/ai build`, including the native make target.
- PASS — `node --test apps/node/test/monitoring-process.test.mjs apps/node/test/mdns-advertisement.test.mjs apps/node/test/camera-sessions.test.mjs apps/node/test/camera-continuity.test.mjs apps/node/test/camera-activity.test.mjs`: 22/22, including actual Hub startup and graceful SIGTERM exit code 0.
- PASS — `HAUS_HELPER_PATH=/Users/resonaura/haus/apps/hub pnpm --filter @haus/node test:integration`: two real local integrations passed; one provisioned-container scenario skipped. Encrypted configuration and recording exports preserve exact bytes and reject overwrite; playback preserves audio/originals across remote/weak/offline modes.
- PASS — `pnpm architecture:check`: 421 source files; `pnpm lint`; `pnpm rules:check`; explicit changed-test Prettier; `git diff --check`.

The first lint run rejected two explicit throws in finally blocks. Cleanup now preserves the primary error and aggregates cleanup failures; the rerun and full workspace lint pass. No check configuration was weakened.

## Limits and continuation

Real mDNS sockets, Windows directory-sync behavior, native camera hardware paths and a provisioned container were not verified. Docker build/deploy and service installation were not run; interim path changes are not container acceptance. Ten native/environment cases and one provisioned-container integration remain skipped.

P16.1 must finish real Hub authentication and standalone composition before release: Live still has a fixture-token default, AuthGuard permits arbitrary bearer values if its auth service is absent, and some prototype controllers have no guard. These observed existing gaps are recorded in PLAN.md; do not deploy this accumulated migration as a production-ready server.

Continue P14.2.3.3, preserving upgrade data paths, instance IDs, keys, archives, media permissions and wire signatures. The goal and hourly automation stay active without subagents. Commit/push remains conditional on verified completion of the agreed plan, and branches remain unchanged.
