# Haus monorepo

Haus Desktop (`apps/desktop`), Haus Mobile (`apps/mobile`), standalone Haus Hub (`apps/hub`), and all 17 shared packages (`packages/*`) share one canonical source repository: <https://github.com/resonaura/haus>.

## Consolidation status

The monorepo consolidation is complete:

- The former separate Helper and NVR repositories were merged here and consolidated into the single NestJS server application [`apps/hub`](../apps/hub) (retiring the interim `apps/node` app).
- Shared contracts, native protocols, Kitsune compatibility, media/AI engines, HomeKit/HKSV, host telemetry, E2EE IPC, and the C++20 icon worker live under `packages/*`.
- The optional Home Assistant integration shim lives at [`custom_components/haus`](../custom_components/haus) for HACS compatibility.
- Camera bridge image handoff uses the shared [snapshot contract](bridge-snapshots.md).
- Root workspace commands (`pnpm check`, `pnpm build`, `pnpm package`, `pnpm deploy:hubs`) govern all applications and packages from one pnpm lockfile.
