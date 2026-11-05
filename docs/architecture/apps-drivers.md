# Haus Apps Driver Contract and Runtime Audit

## 1. Overview

Haus Apps decouple container lifecycle management from the underlying execution runtime through the neutral `AppDriver` port in `@haus/apps`. Workloads can run either directly via standard Docker Engine (`DockerApps`) on standalone hosts or via Home Assistant Supervisor (`SupervisorApps`) on legacy HAOS environments.

Supervisor is strictly an adapter in `packages/ha`, not a core or platform-wide requirement. Standalone Haus Hubs and Nodes operate with full capability using standard Docker.

## 2. Driver Contract & Capability Model (`packages/apps/src/types.ts`)

Every app driver must implement the `AppDriver` interface and declare its concrete capabilities:

```typescript
export interface AppDriverCapabilities {
  readonly lifecycle: true; // start, stop, restart
  readonly install: boolean;
  readonly remove: boolean;
  readonly update: boolean;
  readonly configure: boolean;
  readonly logs: boolean;
  readonly info: boolean;
}

export interface AppDriver {
  readonly id: string;
  readonly capabilities: AppDriverCapabilities;
  list(signal?: AbortSignal): Promise<readonly RuntimeApp[]>;
  execute(externalId: string, action: AppAction, signal?: AbortSignal): Promise<void>;
  inspect(externalId: string, signal?: AbortSignal): Promise<AppOperationResult<AppInfo>>;
  operate(
    operation: AppOperation,
    externalId: string,
    options?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AppOperationResult>;
}
```

### 2.1 Explicit Unsupported-Operation Results

Extended operations (`install`, `remove`, `update`, `configure`, `logs`) are not assumed to exist on every runtime. When an unsupported operation is invoked, drivers return an explicit, non-throwing `AppOperationResult`:

```typescript
export interface AppOperationResult<T = unknown> {
  readonly status: 'ok' | 'unsupported' | 'error';
  readonly data?: T;
  readonly reason?: string;
}
```

This prevents silent failures, unexpected exceptions, or false assumptions about container management capabilities.

## 3. Runtime Audit & Supported Operations Matrix

| Capability / Operation       | Docker Driver (`DockerApps`)                    | Supervisor Adapter (`SupervisorApps`)           | Contract Status       |
| :--------------------------- | :---------------------------------------------- | :---------------------------------------------- | :-------------------- |
| **List Containers / Addons** | Supported (`GET /v1.XX/containers/json?all=1`)  | Supported (`GET /addons`)                       | Active                |
| **Start App**                | Supported (`POST /containers/{id}/start`)       | Supported (`POST /addons/{slug}/start`)         | Active                |
| **Stop App**                 | Supported (`POST /containers/{id}/stop`)        | Supported (`POST /addons/{slug}/stop`)          | Active                |
| **Restart App**              | Supported (`POST /containers/{id}/restart`)     | Supported (`POST /addons/{slug}/restart`)       | Active                |
| **Inspect App Metadata**     | Supported (`inspect()` via metadata)            | Supported (`inspect()` via addon metadata)      | Active                |
| **Install / Add**            | Explicitly Unsupported (`operate('install')`)   | Explicitly Unsupported (`operate('install')`)   | Planned (P3.3 / P3.4) |
| **Remove / Uninstall**       | Explicitly Unsupported (`operate('remove')`)    | Explicitly Unsupported (`operate('remove')`)    | Planned (P3.3 / P3.4) |
| **Update Workload**          | Explicitly Unsupported (`operate('update')`)    | Explicitly Unsupported (`operate('update')`)    | Planned (P3.3 / P3.4) |
| **Configure / Options**      | Explicitly Unsupported (`operate('configure')`) | Explicitly Unsupported (`operate('configure')`) | Planned (P3.3 / P3.4) |
| **View Logs**                | Explicitly Unsupported (`operate('logs')`)      | Explicitly Unsupported (`operate('logs')`)      | Planned               |

## 4. Security Invariants & Adapter Isolation

### 4.1 DockerSocket Allowlist

`DockerSocket` (`packages/apps/src/socket.ts`) communicates with local Docker Engine over a Unix domain socket. To prevent privilege escalation and arbitrary container execution:

- Only exact URL patterns are accepted:
  - `GET /version`
  - `GET /v1.XX/containers/json?all=1`
  - `POST /v1.XX/containers/[a-f0-9]{64}/(start|stop|restart)`
- Any other request (e.g. `containers/create`, `images/create`, `exec`, arbitrary host mounts) is rejected immediately with `docker_operation_not_allowed`.
- Payload response size is bounded to 4 MB to prevent memory exhaustion.

### 4.2 Managed Ownership Fencing

`DockerApps` distinguishes Haus-managed containers from foreign host workloads using the container label `io.haus.app`. Unmanaged containers are listed read-only; start/stop/restart operations on foreign containers are rejected with `unmanaged_app`.

### 4.3 Supervisor Secret Stripping

`SupervisorApps` filters out sensitive credentials (passwords, auth tokens, internal config) returned by the Supervisor API (`/addons`) before constructing the runtime app model. Addon slugs are strictly validated against `^[-a-zA-Z0-9_]{1,128}$` to block path traversal.
