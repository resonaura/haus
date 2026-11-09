# Scrypted state projection

## P18.6.2.1 — Preserve unknown state

`inspectScryptedDevice` previously treated a missing `online` property as online, labeled such cameras as streaming, and filled absent motion, contact, intercom, power, lock, cover, brightness, and temperature states with defaults. It now leaves device and endpoint availability `unknown` until `online` is explicitly reported, emits readings only for values with the expected type, and retains observed `false`/`0`. Non-finite measurements and out-of-range brightness percentages are omitted. A reported camera `online` state is projected as online/offline, never as active streaming.

Regression coverage exercises sparse interface discovery, explicit false/zero values, and non-finite measurements. The initial focused run failed on the false-online and `NaN` cases; after the fix:

- `pnpm --filter @haus/kitsune build` — PASS
- `pnpm exec vitest run packages/kitsune/test/scrypted.test.ts packages/kitsune/test/virtualization.test.ts packages/kitsune/test/compatibility.test.ts --maxWorkers=1 --reporter=dot` — PASS, 3 files / 18 tests
- `pnpm --filter @haus/kitsune typecheck` — PASS
- `pnpm exec oxlint --deny-warnings packages/kitsune/src/scrypted/adapter.ts packages/kitsune/test/scrypted.test.ts` — PASS
- `pnpm exec prettier --check packages/kitsune/src/scrypted/adapter.ts packages/kitsune/test/scrypted.test.ts docs/backlog/kitsune.md` — PASS
- `git diff --check` — PASS

This proves the adapter contract for supplied records; it does not validate live third-party plugin payloads or physical camera availability.
