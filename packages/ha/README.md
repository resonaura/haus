# Home Assistant compatibility adapter (`@haus/ha`)

`@haus/ha` is Haus's optional external Home Assistant compatibility adapter. It owns the HA REST/WebSocket wire protocol, OAuth transport, raw registry/entity types, service/feature mapping, Supervisor apps/ingress adapter, brand icon resolver, and pinned integration catalog utilities.

It depends on provider-neutral `@haus/core` and `@haus/state`; neither core package nor standalone Haus Hub requires Home Assistant to operate.

- `HaHomeAdapter` and `HaProvider` adapt external HA sessions behind neutral core ports, normalizing capabilities and returning explicit `accepted` command receipts without claiming physical confirmation.
- `SupervisorApps` implements `@haus/apps` strictly when an actual Supervisor is present; Supervisor capabilities are never inferred merely because HA is reachable.
- `native/brand-icons.ts` resolves integration, add-on, HACS, Homebridge, and Scrypted brand assets across local directories, upstream catalogs, GitHub (`?size=512`), and bundled vector fallbacks.
- Platform-specific entry points stay isolated so mobile/browser bundles never pull in Node or Electron dependencies.

See [platform architecture](../../docs/architecture/platform.md) and [`PLAN.md`](../../PLAN.md).
