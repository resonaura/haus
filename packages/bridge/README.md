# Native camera bridge protocol

Shared TypeScript ESM building blocks for direct Aqara/Tuya → Haus integration.
This package is independent of Home Assistant, MQTT libraries and camera media
workers. Discovery advertises `_rsnra-camera._tcp` with a persistent bridge ID,
provider and protocol profile, without credentials or camera/media URLs.
Discovery is untrusted; a one-use local pairing code authorizes inventory access.

`CameraBridgeProvider` persists only identity and token hashes in private files.
Its default `disableMqttWithHaus: true` policy suppresses **HA MQTT publishing**
only after the enrolled native consumer acknowledges the complete inventory.
The option can be disabled to retain MQTT alongside Haus. Pairing/discovery
alone never suppresses MQTT. Confirmed ownership persists through temporary
disconnects and restarts, preventing legacy entities from repeatedly reappearing.
Explicit revocation/removal restores MQTT. New capabilities require a fresh
complete ACK before updating the confirmed inventory; the existing owner remains
responsible for its migrated entities while unavailable.
Tuya's upstream cloud MQTT signaling is independent and must remain enabled.

The host gates its HA MQTT publisher using `shouldPublishMqtt()` and handles
`mqtt-publication` transitions by withdrawing
or restoring its own retained discovery records. Keep collecting native state
and real snapshot frames in both modes. Do not delete third-party discovery.
This package alone does not change a bridge's MQTT transport or migrate HA
entities; adapters and the native HA entity acknowledgement are required first.

`CameraBridgeHttp` mounts the bounded `/api/haus/v2/` endpoints in the provider's
existing HTTP server. Only `info` and one-use-code `enroll` are public. Inventory,
complete-handover ACKs, lease renewal, self-revocation and entity commands require
the enrolled Bearer token. Writable entity definitions determine allowed values;
the transport accepts no arbitrary topics, URLs or executable templates. Commands
serialize per entity and coalesce repeated request IDs while in flight; consumers
must not automatically replay physical commands after a disconnect or restart.

Inventories contain only actual supported cameras/entities. Source URLs are
available only to an authenticated controller and still require the consumer's
private-address/source validation before use. The revision excludes changing
readings but includes the complete entity capability shape. A ready ACK must
cover every camera and entity; an old/incomplete ACK cannot hide MQTT controls.

License: GPL-3.0-or-later; see the repository LICENSE.
