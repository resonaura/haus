# Home Assistant compatibility adapter (`@haus/ha`)

`@haus/ha` is Haus's external Home Assistant Hub compatibility package. It owns the HA REST/WebSocket wire protocol, OAuth transport, raw registry/entity types, service/feature mapping, Supervisor apps/ingress adapter, HA-authenticated brand icon endpoints, and pinned HA integration catalog utilities.

All Haus Hub domain contracts, Hub mesh/coordinator clustering (`@haus/core/hub`), neutral server/storage types (`@haus/core/servers`), shared `Preferences` & `PreferenceSync` (`@haus/core/preferences`), `OptimisticState` / `OptimisticSessionController` (`@haus/core/optimistic`), and platform-neutral brand catalog resolution (`@haus/core/brands`) live in `@haus/core`.

- `HaHomeAdapter` and `HaProvider` adapt external Home Assistant hubs behind neutral core ports, normalizing capabilities and returning explicit `accepted` command receipts without claiming physical confirmation.
- `HaHelperClient` (`helper-client.ts`) and `HaIngressHelperPort` (`helper-ingress.ts`) scope Home Assistant helper clustering strictly to optional NVR video nodes (`storage | stream`) plus `/api/ha-integration` for sharing cameras and entities back into Home Assistant.
- `SupervisorApps` implements `@haus/apps` strictly when an actual Supervisor is present; Supervisor capabilities are never inferred merely because HA is reachable.

See [platform architecture](../../docs/architecture/platform.md) and [`PLAN.md`](../../PLAN.md).
