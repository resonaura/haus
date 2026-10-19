# Media reliability and private device inventory

Validation performed on 2026-10-19. Household addresses, keys, camera URLs and raw inventory remain outside the repository.

## Verified

- The three available live cameras expose H264 video and AAC mono audio at 16 kHz. Resolutions: 2688×1520, 1920×1080 and 2304×1296. A fourth upstream camera was unavailable; it is not counted as healthy.
- Helper recording audio is enabled. A real synthetic H264/AAC buffer passes finalization, audio-track inspection and thumbnail generation. Legacy clips without source audio cannot recover missing sound.
- Recorder progress has a 30-second watchdog with bounded reconnect backoff and SIGTERM/SIGKILL escalation. NVR relays expire when their ready playlist stops advancing. Incoming HTTP media batches are paced against their media clock.
- Camera previews use separate server leases, with limits, idle expiry, hidden-window release and battery-camera exclusions. Older helpers must advertise support before the app enables preview preheat. Active recording buffers are reused.
- Last camera stills have per-home SHA-256 keys, a bounded memory cache and encrypted local disk storage. Disk persistence is skipped when secure encryption is unavailable. Concurrent requests for the same camera share one download.
- Camera UI checks in isolated Electron windows cover fill/fit, a painted 64×36 canvas ambilight, full viewer fullscreen with controls/history, capability-based camera light controls, synthetic microphone waveform movement, circular outlet controls, Apple TV remote availability and scene-editor icon geometry.
- A private inventory of 1,044 states and 191 devices was normalized. All 22 enabled/unhidden security-class entities have an accessory owner; 11 physical button controllers are represented. Exact clock integration twins are joined. Service areas are omitted, and physical hubs keep their own room.
- The eight shared layout fields match the helper allowlist: favorites, hiddenApp, hiddenHome, unhiddenApp, deviceOrder, autoGroupLights, disabledLightGroups and roomIcons. Device theme and local light memories are intentionally device-local.
- The three-node integration contract verifies encrypted configuration replication, media distribution, disk replacement recovery and scoped range streaming.

## Recording audit in progress

The initial inventory contains 478 entries: 434 ready clips, 43 failed events and one interrupted event. Every ready clip is scheduled for packet/timestamp inspection and full audio/video decode, using two bounded workers and a resumable private report. Failed/interrupted events are reported as such rather than counted as playable videos. Compatibility preparation preserves original recordings.

Do not interpret an early passing sample, absence of decode errors, or a normalized frame cadence as proof that an upstream camera never froze. Source gap diagnostics and legacy audio absence remain separate findings. Final totals and any failures must be reviewed after the audit finishes.

References: [Home Assistant Apple TV controls](https://www.home-assistant.io/integrations/apple_tv/), [Home Assistant related-item search](https://github.com/home-assistant/core/blob/dev/homeassistant/components/search/__init__.py), [FFmpeg media formats](https://ffmpeg.org/ffmpeg-formats.html).
