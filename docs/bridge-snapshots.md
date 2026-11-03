# Camera bridge snapshot handoff

Haus can reuse the last real JPEG captured by the Aqara and Tuya bridges. This
optional protocol transfers an image and its original capture time; it does not
change the camera's RTSP/P2P transport or replace ordinary bridge Offline cards.
The shared validator is in `@haus/media/snapshot`.

## Discovery and identity

A provider exposes `GET /api/haus/cameras`:

```json
{
  "version": 1,
  "provider": "aqara",
  "cameras": [
    {
      "stream": { "protocol": "rtsp:", "port": 8554, "path": "/camera-id" },
      "snapshotPath": "/api/cameras/camera-id/snapshot/last-live"
    }
  ]
}
```

The port/path above are examples. Providers advertise their actual source
identity without credentials. Helper obtains the installed add-on address from
Supervisor, checks the expected provider, and matches the original Generic
camera's exact RTSP protocol, port and path. Host-network providers also require
a verified host LAN address. Names and room labels do not establish identity.

A provider may instead advertise these attributes on an HA entity belonging to
the same registered physical camera:

```json
{
  "haus_snapshot_profile": 1,
  "haus_snapshot_provider": "aqara",
  "haus_snapshot_url": "http://bridge.lan:8580/api/cameras/camera-id/snapshot/last-live"
}
```

The provider value is `aqara` or `tuya`. Conflicting capabilities are not accepted.
Generated Haus camera entities are excluded from discovery and cannot become
their own media input.

## Image response

`GET /api/cameras/<id-or-slug>/snapshot/last-live` returns only a real JPEG:

| Header                        | Value                                                              |
| ----------------------------- | ------------------------------------------------------------------ |
| `Content-Type`                | `image/jpeg`                                                       |
| `X-Haus-Snapshot-Profile`     | `1`                                                                |
| `X-Haus-Snapshot-Provider`    | `aqara` or `tuya`                                                  |
| `X-Haus-Snapshot-Captured-At` | Original Unix capture time in milliseconds                         |
| `X-Haus-Snapshot-Stale`       | `1` after 30 seconds without a newer captured frame, otherwise `0` |

When no verified real frame exists, return 404. A stale real frame can still be
returned with its original timestamp. Reading or re-encoding a cached native
keyframe must not renew its age. The bridges keep a provenance-specific cache;
generated Offline cards and ordinary fallback images never enter this route.

Haus accepts at most 6 MiB, validates JPEG boundaries and response metadata,
rejects future capture times beyond the clock tolerance, pins private DNS
resolution, and follows no redirects. URLs cannot contain credentials, queries
or fragments. Loopback and public destinations are rejected. HA credentials are
never forwarded to a bridge.

## Cache and consumers

Helper coalesces concurrent image requests and persists the last verified frame
privately with its capture time. Desktop previews, the HA integration and the
optional HomeKit accessory share this cache. A provider failure preserves the
old real frame as stale; it does not fall through to a generated Offline stream.
Older providers without this capability can still use the owned NVR capture
path. Ordinary provider endpoints retain their existing Offline behavior.

The native HA integration uses scoped Helper capabilities for snapshots and
WebRTC. Existing Generic Camera identities can use the separately enrolled
read-only HTTP Basic snapshot endpoint described in
[`custom_components/haus/README.md`](../custom_components/haus/README.md).
