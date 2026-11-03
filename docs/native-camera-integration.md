# Native camera providers and Home Assistant

Haus can import an enrolled Aqara or Tuya bridge directly. Camera media, snapshot provenance, physical controls and Activity state come from the authenticated provider; a Generic Camera or MQTT entity is not required as the media source. Aqara retains its protected P2P restream. Independent NVR workers handle live media and recording.

## Pairing and import

Use **Add device → Camera → Camera bridge** to discover a managed add-on or a LAN provider. Managed discovery verifies the actual Supervisor add-on and provider UUID. Standalone providers require their own short-lived pairing code; multicast discovery alone does not authorize access. Manual address entry is available when discovery is blocked.

Import preserves an existing recording camera ID only after exact hardware identity or protected-source matching. A matching name or room is insufficient. New cameras start in Stream Only. Importing media does not withdraw MQTT discovery or grant Home Assistant write access.

Provider mDNS uses `_rsnra-camera._tcp`; Haus nodes retain `_haus-nvr._tcp`. Tokens, RTSP addresses and snapshot contents are absent from advertisements.

## Native entities

Install the Haus integration through HACS. A normal camera-only enrollment remains read-only. Generate an explicitly native-enabled setup code in Haus to add supported controls, or reconfigure the existing integration with that code. Reconfiguration preserves the integration's unique ID and existing camera identities.

The thin HA adapter creates only advertised supported lights, switches, buttons, numbers, selects and sensors. Each camera's canonical Activity sensor combines the native detector and opted-in Activity Assist. It replaces raw duplicate motion presentations. Cameras and controls share one native Haus device per physical camera, with verified source metadata and a persistent provider/camera identity. HA 2026.8 scopes hardware identifiers to each integration; identifiers alone do not merge devices across integrations. Existing entity IDs and user preferences must be migrated explicitly. Read-only helper camera views link to their existing source device instead of copying its identifiers.

Indicator LEDs, spotlights, automatic night vision and forced infrared emission are separate capabilities. E1 cameras have no spotlight. HomeKit's night-vision permission maps to the provider's actual Auto/Off values, never an invented forced-On command.

## Retiring legacy MQTT

Discovery, pairing, import and reading entity lists do not complete migration. The HA adapter reports readiness only after the camera and every supported entity have been added to HA. Helper requires a fresh report for the current provider revision from a non-revoked native grant before an administrator can confirm handover.

Before handover, preserve the source configuration and entity registry, migrate exact entity IDs/preferences and inspect automation/dashboard references. Keep recording IDs and original media associations unchanged. A retained legacy control must have a supported native replacement or an explicit disposition before removal.

The provider's default **disable MQTT with Haus** option affects HA discovery/state publication only. Users can retain MQTT explicitly. Confirmed native ownership persists across transient HA outages so MQTT duplicates do not reappear. Explicit provider revocation restores that provider's MQTT publication. Tuya cloud MQTT used for P2P signaling is separate and remains enabled.

Removing the HA integration explicitly revokes its scoped camera grant. Helper journals the corresponding presentation release and retries it if a provider is temporarily unavailable, including after a Helper restart. Once acknowledged, MQTT publication resumes while the provider's media enrollment, native source mapping and recording settings remain intact. Release retries run independently of media/inventory heartbeats and serialize only against ownership changes on the same bridge. A pending stale retry cannot release a newer confirmed owner. This recovery requires SDK 0.1.4 in the provider and Helper 0.3.70 or later; it never treats an ordinary disconnect or HA reload as removal.

If Helper itself is unreachable during HA removal, HA cannot deliver revocation and reports that limitation. Do not infer removal from a heartbeat timeout or automatically publish duplicate entities; explicit grant revocation is still required when connectivity returns.

The administrative handover API is `POST /api/providers/<provider UUID>/handover`. It cannot bypass readiness or retire exactly identified legacy camera/MQTT entities that still need migration. The camera settings and imported-bridge screen show the authenticated review from `GET /api/providers/handover`, including pending explicit restoration and existing ownership. Fresh cameras with no legacy identities can finish connecting in the app once HA materialization is complete. Source import alone does not run handover.

### Transfer existing entities

Helper 0.3.72 and desktop v0.1.12 add **Review transfer → Prepare transfer → Finish connecting**. Review is read-only. Preparation preserves canonical public entity IDs, names, icons, rooms, labels, aliases and user-disabled/hidden preferences. Every older field without a supported replacement needs explicit acceptance. Preparation parks legacy entities as disabled/hidden and disables only an isolated, exactly verified Generic config entry; it never deletes entries or calls a physical device service. Original camera IDs, settings and media catalogs are unchanged.

Only exact registered hardware/control identities authorize replacement. Similar camera names, presentation aliases and same-name stream telemetry cannot prove a Generic config's source. Ambiguous or unverified integrations require manual review. Domain-specific entity options and integration-owned disabled flags are blocked instead of silently losing measurement/privacy semantics.

Saved HA automations, scripts, scenes and dashboards are read to protect references. Existing entity-based targets keep their canonical IDs. References to old device IDs, internal registry UUIDs, temporary native IDs or fields without replacements block automatic transfer; the app identifies the affected configurations. The transfer does not rewrite arbitrary device automation semantics. An unreadable configuration blocks preparation. Configuration contents and credentials never enter the journal or UI.

The reviewed registry and configuration revision is checked again before writes. A private SQLite journal survives restart and records actual identities, allowing reconciliation after a lost response. **Undo transfer** is available before final handover. It restores IDs/preferences without overwriting later user edits; conflicts stay visible for review. Finishing rechecks saved references and parks a durable finalization fence before contacting the provider. If that response is lost, retry Finish; Undo is no longer safe because MQTT discovery may already be withdrawn. After final handover, explicit HA grant revocation restores MQTT publication through the separate recovery mechanism above, rather than promising a full metadata rollback.

For preserved user-disabled controls, adapter 0.1.7 counts only exact registered user-disabled entities or completed added-to-HA lifecycles. Enabled but unloaded entities and integration-disabled entities do not count. This capability is negotiated with Helper and expires with readiness evidence; an older adapter must be updated before a transfer that needs it.

Admin endpoints are `POST /api/providers/<UUID>/migration/review` with `{}`, `/apply` with the reviewed `revision` and explicitly accepted `retire` entity IDs, and `/undo` with `revision`. Preparation/undo return a job status; the app polls it without replaying actions. `GET /api/providers/<UUID>/migration` exposes the redacted review and phase.

## Source and archive continuity

Only genuine cached JPEGs are shared, with their original capture time. Reading a cached picture does not renew Online state. A disconnected camera can keep its last picture without being reported Online.

Static native/proxy/source identity belongs in HA capability attributes, which remain available while the camera is unavailable. HA omits extra state attributes in that state; using them for primary/proxy identity can hide a disconnected camera. See HA's [state and attribute rules](https://contributors.home-assistant.io/core/entities/state-attributes/). The same applies to native control and Activity identity; changing detector state remains ordinary state data.

Native provider state is independent of HA Core's entity presentation. An add-on still depends on the machine hosting it: losing the HA host also loses bridge processes physically running there. Haus does not claim otherwise.

Keep an authenticated catalog baseline before migrating an existing home. Compare retained original camera/event identities and original digest references, accounting for the existing age-retention policy and prepared-copy adoption. Read old media ranges on each archive node after migration. This migration must not change recording policies, delete originals or regenerate event IDs.

HA registry semantics: [single-config-entry devices](https://contributors.home-assistant.io/blog/2026/07/21/device-registry-single-config-entry/).
