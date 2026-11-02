# @haus/media

Shared TypeScript ESM camera-source validation. Resolves and pins private LAN addresses before a host hands a source to a media engine. Hosts remain responsible for source ownership, user policy and camera-specific P2P credentials. The package has no application imports.

The `./snapshot` export implements the bridge handoff contract. A bridge advertises `haus_snapshot_profile: 1`, `haus_snapshot_provider: aqara|tuya` and `haus_snapshot_url` on the existing device-linked HA snapshot sensor. Generic wrappers are also matched against `/api/haus/cameras` from a Supervisor-discovered provider: exact RTSP protocol, port, path and verified host identity must agree. Names and rooms never establish ownership.

`GET /api/cameras/<id>/snapshot/last-live` returns only a real cached JPEG with `X-Haus-Snapshot-Profile: 1`, `X-Haus-Snapshot-Provider`, `X-Haus-Snapshot-Captured-At` (Unix milliseconds) and `X-Haus-Snapshot-Stale: 0|1`. A missing real image returns 404. The original timestamp survives outages and restarts; 30 seconds without a frame is stale. Ordinary snapshot routes may keep their Offline cards. This handoff never triggers a capture, starts a stream, pushes images to an automatically discovered server, or transmits device/HA credentials.

Haus pulls only from private addresses, pins DNS, rejects redirects and Haus-generated proxies, caps JPEG bodies and shares its resulting cache with desktop, HA and HomeKit consumers. Older providers without this contract retain the owned-source fallback. Once a provider advertises the contract, errors preserve the cached real frame rather than importing a possible Offline card from its fallback video stream.
