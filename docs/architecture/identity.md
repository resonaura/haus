# Canonical identity

`@haus/core/identity` defines canonical mappings independently of credentials, leases, owner generations, names, rooms and IP addresses. A reference consists of home ID, record kind, source-instance ID and source external ID. A device and endpoint may use the same external key without colliding. Two integrations with matching labels are separate until explicitly linked.

`IdentityRegistry` allocates an opaque ID only when no binding exists. The injected `IdentityRepository` must atomically commit forward bindings and reverse ownership in durable host storage. It must serialize competing writers and roll back a failed transaction. A recreated registry reuses that storage; this package does not select a database or make an in-memory fixture durable.

`adopt` imports an existing ID and explicit aliases. Every alias must have the same home and record kind. Existing conflicting bindings, cross-home/kind ID reuse and allocator collisions fail; no last-writer-wins overwrite is permitted. Camera IDs and archive IDs/digests are imported independently in their own record kinds. This does not rewrite archive associations or infer that a similarly named source is the same camera.

The canonical HA adapter can receive this registry. It looks up the old prefixed mapping before allocating, preserving already-issued IDs. Its compatibility `Identities` path remains available while composition roots acquire durable repositories. Installing the new source does not migrate a production database. A legacy ID shared ambiguously between homes requires explicit reconciliation and is rejected by the new registry.

`ResourceRef` identifies an exclusive integration, automation, radio, HomeKit identity or media job independently of its current owner. Ownership/lease/session generations are separate contracts in P1.2–P1.5, so changing a Hub does not create a new device or resource ID.

Evidence: `packages/core/test/identity.test.ts` covers home/kind/provider separation, restart reuse, installed camera/archive imports, atomic conflict rejection and allocation collisions. The HA adapter fixture verifies retention of an existing endpoint ID across registry adoption, label changes and changed address metadata.
