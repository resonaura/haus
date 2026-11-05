# Home Assistant Runtime Lifecycle Port

## 1. Overview

Haus Hub orchestrates camera streaming, NVR recording, multi-node clustering, and local device control. Historically, lifecycle checks, backup coordination, and runtime queries interacted directly with the Home Assistant WebSocket client (`HaClient`) and legacy Supervisor REST endpoints.

To maintain clean architectural boundaries and enable testability without live external containers or network dependencies, the Home Assistant runtime lifecycle is decoupled into an explicit, injected port contract: `HaRuntime`.

## 2. Port Contract: `HaRuntime`

The interface is defined in `packages/ha/src/runtime/types.ts`:

```typescript
export interface HaRuntime {
  readonly connected?: boolean;
  status(): Promise<HaRuntimeStatus>;
  configuration(): Promise<HaRuntimeConfig>;
  backup(options?: HaRuntimeBackupOptions): Promise<HaRuntimeBackupResult>;
  update(options?: HaRuntimeUpdateOptions): Promise<HaRuntimeUpdateResult>;
  stop(): Promise<void>;
  start?(): Promise<void>;
  restart?(): Promise<void>;
}
```

### Key Models

- `HaRuntimeStatus`: Reports the current state (`running`, `starting`, `stopped`, `failed`, `updating`), connection status, core version, and optional Supervisor status (`available`, `version`, `channel`, `healthy`).
- `HaRuntimeConfig`: Exposes essential HA environment details (base URL, WebSocket endpoint, timezone, unit system, installed components) without exposing sensitive credentials or private tokens.
- `HaRuntimeBackupOptions` & `HaRuntimeBackupResult`: Coordinates local backup generation (slug, timestamp, size) with support for cancellation via `AbortSignal`.
- `HaRuntimeUpdateOptions` & `HaRuntimeUpdateResult`: Coordinates core/supervisor update triggering and version checks.

## 3. Implementations

### 3.1 `HaRuntimeAdapter`

Located in `packages/ha/src/runtime/adapter.ts`, this adapter satisfies `HaRuntime` in production environments:

- Queries core configuration and status via `get_config` over the authenticated HA client WebSocket.
- Integrates with Home Assistant Supervisor (`/supervisor/info`, `/backups/new/full`, etc.) when running in a managed Supervised or HAOS environment.
- Respects graceful shutdown via `stop()`, disconnecting clients and fencing subsequent calls.

### 3.2 `FakeHaRuntime`

Located in `packages/ha/src/runtime/fake.ts`, this in-memory implementation enables fast, deterministic testing:

- Allows test suites to simulate connected, disconnected, updating, and stopped states.
- Records calls to `backup()` and `update()` for verification.
- Supports programmatic state transitions via `setConnected()` and `setStatus()`.

## 4. Hub Orchestration Integration

Hub orchestration (`apps/hub/lib/servers.mjs`, `apps/hub/lib/server.mjs`, and `apps/hub/lib/bootstrap.mjs`) consumes `HaRuntime` via constructor injection:

- `servers.isOnline()` checks `this.runtime?.connected ?? this.ha?.connected`.
- Teardown is registered with the lifecycle scope: `scope.defer(() => runtime.stop())`.
- Full backwards compatibility is preserved for existing API endpoints and legacy callers.
