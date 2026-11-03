# Haus cameras for Home Assistant

This integration presents cameras managed by Haus Helper in Home Assistant. Images come from Haus’s cached RTSP/P2P frame capture and video uses Haus’s own WebRTC workers, with audio. It does not use go2rtc or HA camera-proxy images as source media.

In HACS, add `https://github.com/resonaura/haus` as a custom **Integration** repository, install **Haus**, and restart Home Assistant. In Haus, open a camera’s settings and choose **Connect Home Assistant**. In HA, add the **Haus** integration and enter the displayed one-time setup code. The default Helper address is `http://127.0.0.1:8099` when Helper uses host networking on the same HA host; enter its actual trusted LAN/HTTPS address otherwise.

The code expires after ten minutes and can be used once. The resulting capability grants camera listing, images and viewer signaling only. It cannot administer nodes, reveal RTSP credentials or change HomeKit pairing. Removing the integration revokes its capability when Helper is reachable. Use the Helper administrative client-revocation endpoint if removal occurs while Helper is offline.

Every generated camera has `haus_camera_proxy: 1` and `haus_source_camera` attributes. Both Helper and the Haus application exclude these entities from capture/discovery. Images and video always originate from the original protected source, so pointing an HA dashboard at these views cannot cause recursive capture. Original HA entities and their configurations are not edited. Prefer the Haus views in dashboards; keep the source entities enabled for source discovery.

WebRTC media goes directly from the selected NVR to the browser. The browser must be able to reach the node’s advertised ICE address and UDP ports; a reverse proxy alone does not relay WebRTC. This integration currently supports the HA native camera API from Home Assistant 2026.10 onward. Physical HA/browser acceptance remains required before claiming a deployed installation.

The optional Apple Home/HKSV bridge is separate and is enabled individually in Haus camera settings. A camera already using its native HomeKit path does not need a Haus HomeKit accessory.

License: GPL-3.0-or-later. See the repository LICENSE.

For an existing HA Generic Camera whose identity must remain intact, the read-only `/ha/cameras/<original-id>/snapshot` path also supports HTTP Basic authentication with username `haus` and an enrolled camera capability as its password. Use an explicit private/HTTPS Helper address and a separately enrolled client for that legacy consumer; never put an HA access token or NVR administrator key in the image URL. This Basic form authorizes only exact GET snapshot requests, not listings, signaling or mutations, and revoking the enrolled client disables it. Ordinary bridge snapshot routes keep their existing Offline cards. Prefer the native Haus integration for new camera views and WebRTC.
