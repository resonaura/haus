# Canonical identity

`@haus/core/identity` defines canonical mappings independently of credentials, leases, owner generations, names, rooms and IP addresses. A reference consists of home ID, record kind, source-instance ID and source external ID. A device and endpoint may use the same external key without colliding. Two integrations with matching labels are separate until explicitly linked.

The user-facing ID format is `type::area:device:entity`, for example `switch::bedroom:surge-protector:socket-1`. Every segment uses lowercase kebab-case; underscores, capitals, spaces and alternate separators are invalid. Omit the final entity segment when it repeats the device name, as in `light::bedroom:ceiling-lamp`. Strip an exact device-name prefix from a more specific entity, producing `:brightness` rather than `:ceiling-lamp-brightness`. No fuzzy name matching is involved.

`Addresses` persists these readable IDs against canonical records in a home-scoped, atomic `AddressRepository`. The initial area/name supplies an address; a room move or later label change does not silently rename it. An explicit rename retains prior addresses as aliases. Collisions are reported without inventing a `-2` suffix or taking another record's address. Expanded duplicate-name forms remain accepted as retained aliases. Readable addresses are stable scene/API targets while internal record keys preserve imports and archive associations.

`IdentityRegistry` allocates an opaque ID only when no binding exists. The injected asynchronous `IdentityRepository` must atomically commit forward bindings and reverse ownership in durable host storage. It must serialize competing writers and roll back a failed transaction. A recreated registry reuses that storage. Hub's TypeORM/better-sqlite3 implementation lives in `apps/hub/src/storage`; core remains independent of the database.

`adopt` imports an existing ID and explicit aliases. Every alias must have the same home and record kind. Existing conflicting bindings, cross-home/kind ID reuse and allocator collisions fail; no last-writer-wins overwrite is permitted. Camera IDs and archive IDs/digests are imported independently in their own record kinds. This does not rewrite archive associations or infer that a similarly named source is the same camera.

Reinstalling an integration must rebind its new source reference to the existing record, preserving the readable address and scene/automation target. Reuse verified hardware identity where available; otherwise require explicit replacement selection. Missing/offline records keep their reserved addresses. Name similarity alone never authorizes replacement or a physical command. Current product-wide rollout still requires durable host repositories and client/rule migration; these contracts do not rewrite installed HA entity IDs.

The canonical HA adapter can receive this registry. It looks up the old prefixed mapping before allocating, preserving already-issued IDs. Its compatibility `Identities` path remains available while composition roots acquire durable repositories. Installing the new source does not migrate a production database. A legacy ID shared ambiguously between homes requires explicit reconciliation and is rejected by the new registry.

`ResourceRef` identifies an exclusive integration, automation, radio, HomeKit identity or media job independently of its current owner. Ownership/lease/session generations are separate contracts in P1.2–P1.5, so changing a Hub does not create a new device or resource ID.

Evidence: `packages/core/test/identity.test.ts` covers home/kind/provider separation, restart reuse, installed camera/archive imports, atomic conflict rejection and allocation collisions. The HA adapter fixture verifies retention of an existing endpoint ID across registry adoption, label changes and changed address metadata.

`packages/core/test/address.test.ts` covers the exact chosen format, repeated-name shortening, retained aliases, room moves, home-scoped collisions and an integration re-enrollment preserving a scene's target.
