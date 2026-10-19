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

## Completed recording audit

All 478 entries in the initial inventory were classified: 434 ready recordings, 43 failed events and one interrupted event. Every ready **original** was packet-inspected and fully decoded; all 434 packet reports completed, with no non-monotonic DTS. Full decode completed for all, while five originals also emitted decoder errors. Six files contain repeated compressed video blocks; there are nine distinct flagged recordings across those two findings.

Of the 434 originals, 342 contain audio and 92 have no audio track. Packet gaps above 0.5 seconds occur in 334 files: 330 with video gaps and 102 with audio gaps, overlapping. The largest observed packet gap is 28.040201 seconds. No absent audio, missing frames, or repeated source content can be reconstructed faithfully by the app. Original files are preserved.

Playback compatibility copies normalize packet cadence and bounded GOPs. The native bridge now waits for preparation before obtaining an NVR grant, so a legacy replica cannot bypass conversion in a race. All nine flagged compatibility copies passed full decode with zero decoder errors, no packet gaps and audio present. Content recovery is distinct from container/timing repair.

## Final follow-up and fresh capture

The audit was extended through **2026-10-19 13:04:58 UTC** to all **528 completed entries**: **459 ready originals**, 61 failed events and eight interrupted events. All 459 ready originals have complete packet reports and completed full decodes. Of these, 359 have audio and 100 historical files do not. The earlier 334 packet-gap findings, five files with decoder errors and six repeated-block flags are unchanged; the follow-up added no new such findings. Recordings continue after this snapshot.

After helper 0.2.9, three fresh captures contain actual AAC audio and fully decode with no errors, timestamp gaps, non-monotonic DTS or repeated compressed blocks: 30.049 s at 1920×1080, 29.987 s at 2304×1296 and 29.921 s at 2688×1520. Native live WebRTC also received 726 audio packets with zero loss during one check; the viewer was unmuted. These measurements cannot guarantee uninterrupted footage when a source or network stops sending media.

Statistics, scene editing, integrations, NVR and the camera viewer were reviewed in wide and narrow native windows without renderer errors or horizontal document overflow. The statistics view now starts with a current numeric sensor instead of an orphaned entity; the real-home check displayed 167 chart points. Timeline fixtures preserve a centered playhead with at most 15 visible hit targets over thousands of clips. Helper resource observation during capture/finalization was 61.29% CPU and approximately 394 MiB memory; the worker was approximately 88 MiB idle within its 1 GiB cap. These are observations rather than benchmarks.

## Real NVR and recovery validation

Helper 0.2.9 and NVR 0.1.1 are deployed. Advertised source audio is probed before capture and mapped as a required track when present. Explicit local camera RTSP telemetry takes priority over HA HLS, with TCP transport, protocol-specific timeouts and bounded HA fallback. Actual testing found an HA HLS stream advertising AAC without audio packets while its direct camera source delivered sound. HA tokens never accompany direct camera requests. RTSP timeout semantics follow the [FFmpeg protocol documentation](https://ffmpeg.org/ffmpeg-protocols.html#rtsp). The real x64 worker uses a read-only container, dropped capabilities, bounded memory/CPU and a 20 GiB storage budget. It is paired for storage and streaming; recording replication and a signed HTTP 206 MP4 range read pass. Shared configuration is authoritative on the helper. After the final upgrade the node is online with seven encrypted backup copies and an idle synchronization queue; automatic HA backups remain enabled. A fresh native 2304×1296 clip played through the node for ten seconds with zero waiting events and 60,631 decoded audio bytes.

Both a Haus configuration backup and the 1,396,080,743-byte encrypted HA archive were retrieved from that node, independently SHA-256 checked, AES-GCM decrypted and listed as valid archives with their expected members. Temporary verification files were removed. Original HA backups were preserved, and automatic HA backups remain enabled. No restore was performed over the running home.

References: [Home Assistant Apple TV controls](https://www.home-assistant.io/integrations/apple_tv/), [Home Assistant related-item search](https://github.com/home-assistant/core/blob/dev/homeassistant/components/search/__init__.py), [FFmpeg media formats](https://ffmpeg.org/ffmpeg-formats.html).

## Limits of this validation

Narnia's upstream camera remained unavailable. No lights or existing scenes/automations were controlled; Narnia lamps stayed off and a router status LED was left unchanged. Talk waveform/transport tests use synthetic audio; a household microphone and camera speaker were not exercised. Desktop CI covers all six OS/architecture packages, while physical native-window checks in this session were on macOS. Raw camera inventory and detailed recording reports are encrypted outside the repository.
