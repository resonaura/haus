# Home Assistant adapter

`@haus/ha` owns the Home Assistant wire protocol, authentication transport, raw registry/entity types, service/feature interpretation and Supervisor ingress. It depends on the provider-neutral `core` and `state`; neither package depends on this adapter.

`HaHomeAdapter` implements the Haus `HomeAdapter` contract. It assigns identities through the injected persistent `Identities` registry, normalizes supported device capabilities and maps owned endpoint commands back to advertised HA services. Raw entity attributes and service payloads are not the canonical model. Unsupported commands fail; a service acknowledgement is explicitly **accepted**, not physical confirmation. The first canonical mapping covers scalar device controls/readings; the existing complete UI projection remains in `view` during migration. Do not infer complete provider feature coverage from the existence of a contract.

`store` adapts the existing UI snapshot and optimistic predictions to the generic lifecycle/state engine. Session fencing, account switches, command ordering and subscription lifecycle live in core/state. HA request construction and receipt parsing remain here. `view`, old HTTP client/validation and raw wire types are compatibility surfaces for the current clients, not recommended contracts for a new backend.

Home Assistant Container and supervised installations use the same home protocol. App management is separate: Supervisor capabilities must never be inferred merely because HA is reachable. Platform-specific code is imported through explicit entry points so mobile/browser code does not pull in Node or Electron.

Architecture and remaining extraction: [platform design](../../docs/architecture/platform.md), [PLAN.md](../../PLAN.md). No Homebridge driver or HausOS image is claimed by this package.
