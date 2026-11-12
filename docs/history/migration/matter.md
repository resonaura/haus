# Optional Matter Server adapter — 2026-11-10

Removed the hard-coded Matter Server endpoint from `MatterService`. The adapter now starts only when a URL is provided through the injected Matter options or `HAUS_MATTER_URL`. Without an endpoint it skips startup discovery, does not install Matter controls/commissioning, and reports a stable `matter_server_not_configured` error for direct refresh/removal/command paths. This prevents standalone Hub startup from reaching a household HA Matter Server by default while preserving explicitly configured compatibility.

Checks:

- `pnpm --filter @haus/hub typecheck` — PASS.
- `pnpm exec vitest run apps/hub/test/matter/matter.test.ts --maxWorkers=1 --reporter=dot --silent` — PASS, 1 file / 2 tests. The no-endpoint case proves no transport is constructed; the configured `HAUS_MATTER_URL` case uses a loopback WebSocket fixture for node discovery, state updates and commands.
- `pnpm exec prettier --check apps/hub/src/matter/service.ts apps/hub/src/commissioning/adapters.ts apps/hub/src/commissioning/service.ts apps/hub/src/homekit/controller.ts apps/hub/test/matter/matter.test.ts docs/backlog/kitsune.md` — PASS after formatting.
- `git diff --check` — PASS.

No Home Assistant endpoint, physical Matter device, or household broker was contacted by these focused checks. Full Nest startup was not repeated because its unrelated native MQTT listener is bound by the application composition and must be isolated before another full-process smoke test.

## Isolated standalone Hub startup — 2026-11-10

Started the built v10 Hub image on Miku with `--network none`, a read-only root filesystem, temporary `/data` and `/tmp`, loopback bind, and no `HAUS_MATTER_URL` or NVR roles. `/health` returned HTTP 200 with `status: ok`, `mode: standalone`, `ha: false`. The `MatterService` log said the integration was not configured and skipped discovery. The disposable container was removed; the running Hub v8, legacy NVR state/archive, and Home Assistant were untouched.

This confirms the full Hub composition does not discover/connect to Matter when no endpoint is configured, while health remains available. It also resolves the earlier non-isolated smoke ambiguity: that run observed a connection but did not record its endpoint source, so it cannot establish an implicit default.
