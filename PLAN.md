# Haus product and reliability plan

Last updated: 2026-10-20. Work sequentially; no subagents.

## Rules and validation

- Do not control lights outside Narnia. Leave Narnia off after any explicit test. Preserve existing scenes/automations; prefer fixtures and read-only real-home checks.
- Preserve user data, completed backups and unrelated working-tree changes. Do not expose credentials or private camera URLs in reports.
- Implement, inspect the actual UI, run relevant checks, then publish/merge approved PRs. Distinguish verified results from pending work and source limitations.
- Keep dark neutral surfaces, restrained glass, consistent continuous corners, unobtrusive motion and reduced-motion support. No blue tint in grays.

## Completed foundation

- [x] Cross-day virtualized canvas timeline, fixed center playhead, rAF clock and top-date synchronization; indexed calendar markers.
- [x] Calendar blur without gradient; entry/exit/month animations; future dates dim without strikethrough.
- [x] Fixed-height empty timeline with no empty text in live overlay.
- [x] Preserve Live/playing/paused intent when scrubbing; centered camera errors with matching retry color. Verified decoded paused frames.
- [x] Fix sidebar disposal after BrowserWindow destruction; real native camera open, modal close and window close pass.
- [x] Install Aqara 1.6.8 and helper 0.2.9. Both Aqara cameras deliver actual high-resolution frames (2688×1520, 2304×1296).
- [x] Real full HA backup completed: encrypted archive 1,396,080,743 bytes, available after restart; automatic HA backups enabled and verified.
- [x] NVR 0.1.1 published for amd64/arm64 and paired on the requested real server; hardened-container, storage, range streaming and recovery checks pass.
- [x] Haus PR #4 merged as 6a84f44 after successful checks and all six desktop builds on implementation commit d4e9bce. Development app is running with the current code.

## 1. Recordings, audio and streaming reliability (first)

- [x] Inspect every existing recording, not a sample: decode/container integrity, video/audio tracks, media timing, frame gaps, repeated segments, duration and seek behavior. Save a redacted persistent report and counts.
- [x] Establish each live camera's actual audio capability. Enable audio recording where available; preserve audio through all ingest, concat, conversion, relay and playback paths. Report source audio absence rather than fabricate sound.
- [x] Fix recorder liveness, reconnects, stalled FFmpeg, cancellation, source cadence and gap handling with bounded resource use. Preserve originals when repairing compatible playback copies.
- [x] Strengthen helper/NVR stream preheat and app leases, deduplication, battery/privacy/offline handling, reconnects and cache limits. No microphone outside explicit Talk.
- [x] Verify actual stored settings + shared preferences round trip, backups, HA registry coverage and helper features; add missing fields intentionally.

## 2. Camera experience

- [x] Default video fit = cover/fill; toggle to contain; contain mode gets low-resolution canvas ambilight, smooth and bounded, visibility/reduced-motion aware.
- [x] Repair fullscreen on the complete viewer (including controls/history). Remove download and refresh from the camera modal toolbar.
- [x] Always cache the last camera image per home/camera with bounded private storage; blurred last frame while loading, smooth decoded replacement. Cover dashboard and viewer.
- [x] Attractive capability-based camera sliders, including spotlight color/temperature/brightness and camera parameter sliders.
- [x] Talk active waveform bars following the local scrypted-tuya reference, with actual microphone amplitude and cleanup.
- [x] Confirm cross-day calendar and scrub semantics, error layout and audio after real helper update.

## 3. Inventory: inspect every real HA entity/device/room

- [x] Save a private inventory audit; classify physical, diagnostic, configuration, virtual, duplicates, security, buttons/remotes, network and physical hubs.
- [x] Hide service-only entities/rooms; retain physical hubs in their actual rooms. Restore missing security devices and appropriate open/closed/motion/vibration icons.
- [x] Include Hue button/remotes; show actual keys and linked automations without treating stateless buttons as switches.
- [x] Merge Nixie/Nixie Clock related entities into their parent; review camera MQTT relations and spotlight attachment.
- [x] Assign sensible default icons for every real room, keeping user overrides; hide service rooms.
- [x] Network/eero cards and modal: actual connectivity, clients, WAN/mesh and health capabilities with truthful unavailable states.

## 4. Device and editor design

- [x] Apple TV clear brand logo, wider media modal, actual virtual remote if HA exposes remote services. Google/HomePod/Fire TV model-aware artwork.
- [x] Power-strip icon + large circular per-outlet power controls with labels; independent outlet state and optimistic feedback.
- [x] Modernize climate/temperature sensor modals: remove legacy colors, reuse neutral controls.
- [x] Repair scene-editor tiles and responsive layouts, preserving drafts/existing scenes and making explicit tests safe.
- [x] Clean integrations page: consistent artwork, sections, loading/errors, actions and actual integration flows.
- [x] Review neglected areas: integrations, settings, NVR and statistics inspected at wide/narrow sizes. Statistics now start with a present numeric sensor instead of an orphaned historical entity, sort by display name and expose full truncated names.

## 5. Finish

- [x] Regression checks, full app/helper tests and builds; actual decoded native playback, recording archive audit and resource review.
- [x] Review UI at wide/narrow sizes; remove closed review profiles and fixture entry points; release test warm leases; preserve the current development server.
- [x] Publish and merge approved changes after CI; deploy helper 0.2.9 and NVR 0.1.1; confirm versions, shared preferences, automatic HA backups, retained full archive and worker synchronization.
- [x] Report source and hardware limitations accurately. Narnia upstream remains unavailable; historical missing audio/frames cannot be recreated. Talk speaker output and Windows/Linux native materials were not physically exercised on those platforms in this Mac session.

## Validation journal, 2026-10-19

- App: 254 tests pass. Isolated Electron review confirms cover/contain, painted 64×36 ambilight, full viewer fullscreen including controls/history, capability-based RGB/temperature sliders, circular outlet buttons, virtual remote, and repaired scene-editor icons. Synthetic audio produces actual waveform movement; no household microphone was opened.
- Inventory: privately inspected 1,044 states, 191 devices and 12 areas. All 22 enabled/unhidden security-class entities belong to accessories. Eleven button controllers are represented; real Hue automation links verified. One Nixie accessory contains its settings. Service rooms are omitted; physical hubs retained. All eight shared preference fields match the installed helper; theme/light memories remain local by design.
- Live audio/video: Outdoor 2688×1520, Outdoor Side 1920×1080, Guinea Pigs 2304×1296, each H264 with AAC mono audio at 16 kHz. Narnia upstream remains unavailable. Audio recording is enabled.
- Recording audit: checkpointed private report covers the 478-entry initial inventory. Full decode/packet checks have completed for every ready original with two bounded workers; detailed counts below. Source absence and legacy missing audio are retained as findings.
- Helper: 59 local tests pass, including real H264/AAC capture, stalled encoder reaping, private direct-source association and HA fallback. PRs #8–12 merged after CI. Direct-source timeout validated on the real Debian NVR; PR #12 adds actual RTSP negotiation regression coverage. Helper 0.2.9 is installed, connected and buffering all three available cameras from direct RTSP with audio expected.
- NVR: 9 local tests pass, including a real relay and stale-playlist reaping. The three-node helper contract passes: encrypted configuration replication, disk replacement and range streaming. PR #3 validates amd64/arm64 before release 0.1.1. Production node paired; real backups and signed recording ranges verified.

## Real deployment and audit completion

- Earlier releases added authenticated original-media audit reads (0.2.6) and audio discovery (0.2.7). Current helper 0.2.9 additionally uses explicit local TCP RTSP sources with the deployed Linux FFmpeg timeout and bounded HA fallback. Original media is preserved.
- All 478 initial entries audited (baseline, subsequently extended below): 434 ready originals fully decoded and packet-inspected, 43 failed events and one interrupted event. All 434 packet reports completed. Ninety-two originals have no audio track. There are video timestamp gaps in 330 originals, audio gaps in 102 (334 with either); largest observed packet gap 28.040201 seconds. Five originals produce decoder errors while completing decode; six have repeated compressed blocks, nine distinct flagged clips. These are source findings, not a claim that all footage is clean. All nine flagged compatibility copies also passed full decode with zero decoder errors, no packet gaps and audio present. Source content loss/repetition remains a separate legacy finding.
- NVR 0.1.1 is published for both architectures and runs on the requested real server, read-only with dropped capabilities and a 20 GiB budget. It is paired for storage/streaming. Six backup copies and recording replication verified; a real signed recording range returns HTTP 206 with MP4 bytes.
- Actual recovery cycle verified from NVR for Haus and the full HA archive: download, exact size, SHA-256, AES-GCM authenticated decryption and archive membership listing all pass. HA encrypted archive size 1,396,080,743 bytes; automatic HA backups remain enabled. No restore or source deletion performed.
- Native viewer receives real 2688×1520 video, sound enabled by default, fill enabled, closes its modal and destroys its window cleanly. Fixed a handoff hazard by clearing WebRTC srcObject before HLS, and require actual media before treating negotiation as successful. Native playback now waits for compatibility preparation before obtaining an NVR grant, preventing legacy timing from bypassing conversion.

- A forced WebRTC failure with a real H264/AAC HLS fixture verifies the handoff: srcObject cleared, 160×90 video decoded to readyState 4 and playback advancing, with no renderer errors.

## Final validation follow-up

- [x] Post-update captures pass on helper 0.2.9: Outdoor Side 30.049 s, Guinea Pigs 29.987 s, Outdoor 29.921 s. All three contain AAC, fully decode without errors, have no packet gaps, non-monotonic DTS or repeated compressed blocks. The HA HLS audio-loss path now has direct TCP RTSP capture with bounded HA fallback; Linux transport options were checked against actual Debian FFmpeg.
- [x] Extend the audit through 2026-10-19 13:04:58 UTC: all 528 completed entries classified, comprising 459 ready originals, 61 failed and 8 interrupted events. All 459 packet reports and full decodes completed; 100 historical originals have no audio. Existing timestamp-gap findings remain 334, five decoder-error files and six repeated-block flags (nine distinct clips); no new such findings appeared in the follow-up. Nine flagged compatibility copies decode cleanly; originals remain intact.
- [x] Cluster checked after the upgrade: node online, seven encrypted backup copies, synchronization idle, automatic HA backups enabled and the original full HA archive retained.
- Native live Guinea Pigs WebRTC is healthy: 2304×1296, unmuted, audio track present, 726 inbound audio packets / 124,475 bytes, zero packet loss during the check. No household microphone was opened.
- Native prepared playback through the paired NVR passes in order: prepare → source grant → NVR range HTTP 206; 2688×1520 video, readyState 4, playback time advances.
- Latest app source passes 254 tests, TypeScript, lint, architecture and format checks; production build passes. Previous exact commit passed all six platform/architecture builds. The final statistics change passes local checks/build, native UI review (167 actual chart points), and all six desktop CI builds; PR #4 is merged.
- All Narnia lamps remain off. The one on light-domain entity is a router status LED, left unchanged. No lighting or existing scenes/automations controlled.

- Resource observation during capture/finalization: helper CPU 61.29%, memory 413,249,536 bytes of 3,977,572,352; NVR idle CPU 0.01%, memory 88.14 MiB within its 1 GiB cap. These are observations, not benchmarks. The virtualized filmstrip fixture kept at most 15 visible hit targets with thousands of clips and zero center-playhead drift.

- Final fresh native playback through the paired NVR: HTTP 206, 2304×1296, ten seconds advancing, readyState 4, zero waiting events, and 60,631 audio bytes decoded. All four private audit reports are persisted with secure-storage encryption and mode 0600.

## Follow-up: opt-in motion detection and camera reliability

- [x] Preserve a continuous bounded pre-event ring buffer (8 seconds by default), include it in motion clips, extend the tail while motion continues, and verify the actual first frame/time rather than starting capture after a detection.
- [x] Pair the Windows 10 node at 192.168.5.115, validate Docker/WSL startup and apply conservative worker limits for its available memory.
- [x] Reproduce Guinea Pigs recordings failing in the actual camera UI, covering older clips, seeking and repeated selections; fix the complete playback path and verify real samples.
- [x] Measure camera-open latency and remove unnecessary serial waits; improve connection reuse, preheat, fallback and recovery without waking disabled/battery cameras.
- [x] Add per-camera software motion detection, OFF by default, with lightweight temporal/noise/illumination filtering plus efficient object inference rather than raw pixel-diff recording.
- [x] Run detection on compatible NVR nodes first; balance streams across nodes with bounded CPU/memory/concurrency, automatic reassignment and a limited helper fallback. Keep current HA detector recording intact. Hardware distribution and failover are verified below.
- [x] Add clear camera settings, persisted/synchronized configuration and truthful processing status; retain defaults and privacy behavior on upgrades.
- [x] Fix eero physical router display names and classification; use appropriate eero artwork where available.
- [x] Validate on actual streams/recordings and the real NVR, regression tests, deployment and dev stand. Do not change lights or existing scenes/automations.

### Follow-up evidence

- Helper 0.2.10 deployed after 61 tests and successful native amd64/arm64 cloud builds; PR #13 merged. It aligns completed segments to local receipt time and watches segment progress as well as FFmpeg frames.
- Reproduced 100 newest Guinea Pigs capture attempts containing no playable recordings despite a live frame counter. Ready-only indexed paging now exposes actual playable history without burying it behind failed attempts. Four real recordings play consecutively in the native modal at 2304×1296, starting in roughly 0.4–1.2 seconds; all advance without renderer errors.
- Fresh post-fix Guinea Pigs clip: 45.293 seconds, H264 2304×1296 + AAC, 10.274 seconds of keyframe-aligned pre-roll, 50 ms maximum video packet gap, full decode with zero errors. Existing failed captures cannot recreate lost footage.
- Windows node paired at 192.168.5.115. An unattended scheduled task keeps WSL/Docker running and refreshes the private-LAN forwarding address; container healthy after SSH disconnect. Limits: 512 MiB, 0.75 CPU, 20 GiB storage. Observed idle 88.2 MiB, 0.02% CPU after transferring about 4.16 GB.
- NVR motion workers: 12 Node tests, five actual Python/model tests, an advancing live-HLS analysis pipeline, and the three-node helper contract pass. NVR 0.2.2 is published for both native architectures and installed on both real nodes; PRs #4–6 merged.
- App currently passes 259 tests, typecheck, lint, architecture and formatting checks; production build passes. Motion settings were exercised in an isolated native UI fixture with intercepted writes; all software motion settings were restored OFF after the hardware tests.
- Audit extended to 665 completed events: all 467 ready originals decoded/packet-inspected. Eight newly audited clips have audio, decode successfully and have no packet gaps. The 100 historical missing-audio files and 334 legacy timing-gap findings are unchanged; 198 failed/interrupted events are retained as historical failures.
- Real rollout exposed a Linux HLS compatibility failure: opaque gateway IDs removed fragment extensions. Helper 0.3.2 preserves only allowlisted media suffixes; NVR 0.2.2 accepts them without relaxing source isolation or FFmpeg validation. Nested HLS/fMP4 decoding is covered by a real decoder regression. Both NVRs and helper 0.3.2 are installed and healthy; helper PRs #14–15 merged.
- Worker scheduling now subtracts only inactive file cache from cgroup usage, retaining anonymous/shared/active memory in its budget. Both native-architecture NVR builds pass; model tests pass inside both deployed containers.
- An interrupted real NVR transfer resumed through HA ingress at the exact next byte: 32,966,611 bytes and SHA-256 match. Ingress strips Content-Length from chunked ranges; continuation now validates the exact Content-Range and delivered byte count. A separate first-byte deadline prevents a hung node from delaying media fallback indefinitely.
- Native recorded playback through NVR: 2304×1296, ten seconds advancing, zero waiting events, 60,393 decoded audio bytes. Live Side and Guinea Pigs returned real video/audio; one Outdoor attempt took 19 seconds through HLS, while the instrumented repeat connected WebRTC in 3.8 seconds and advanced for twenty seconds with zero lost audio packets. Do not claim every cold start is equally fast.
- Follow-up app checks: 259 tests, typecheck, lint, architecture, formatting and production build pass. Helper: 67 tests. All software detection is OFF; ordinary HA-triggered recording and pre-event buffers remain active.

- Real motion verification: two cameras run on distinct NVR nodes, a stopped Windows worker moves analysis to the helper, and restarting it restores NVR processing. Thirty samples over two minutes remained running on the same two nodes; fifteen more samples over one minute verified object mode on both, including Windows at 0.75 CPU/512 MiB. The observed Windows object-mode peak working set was 103.4 MiB and CPU peaked at 7.3% of its quota during this sample; these are bounded observations, not performance guarantees.
- Software motion produced a real Guinea Pigs recording: 119.964 seconds, H264 2304×1296 and AAC, 9.01 seconds of pre-event footage, maximum video packet gap 50 ms and zero full-decode errors. All motion settings were restored OFF and both nodes report zero active detectors.
- Final live run after parallelizing capability/configuration reads: Outdoor 4.4 s, Side 2.8 s, Guinea Pigs 3.9 s to first frame; all three stay on WebRTC, play audio, advance and report zero lost audio packets and zero renderer errors. Earlier cold-start variability is retained above.
- Full recovery also verified from the Windows node: latest Haus configuration (273,978 encrypted bytes) and full HA archive (1,396,080,743 encrypted bytes) match SHA-256, decrypt with authenticated encryption and contain their expected archive members. The newest configuration needed one normal replication cycle before it became downloadable. No restore or source deletion performed.
- Final archive snapshot at 2026-10-19 22:43:39 UTC: 684 completed events, all 486 ready originals packet-inspected and decoded. All 19 recordings added since the earlier audit have audio, no packet gaps and no decode errors. Historical missing-audio/timing findings remain unchanged; missing original footage/audio cannot be recreated. Detailed reports are saved with secure-storage encryption outside the repository.

## Follow-up: scene editing and idle timeline efficiency

- [x] Capture one valid light colour mode; render the stored scene setting independently of the current live light, including HS/XY and white-only bulbs.
- [x] Anchor accessory settings to their selected tile, improve selected tile feedback and keyboard access, and exclude service-only entities from the add picker without altering existing targets.
- [x] Sleep the canvas scheduler on paused/static history while preserving one stable rAF loop for playback, scrubbing, thumbnail fades and layout changes.
- [x] Verify wide/narrow native UI fixtures, paused/playing gesture intent and large-history virtualization; run local regression checks and queue desktop CI before merging.
- No lighting, existing scenes or automations may be changed by these tests.

### Scene/timeline verification

- Scene capture and colour edits now preserve the matching HA `color_mode`, discard competing formats, and normalize legacy mired capture to kelvin. Draft HS/XY previews no longer inherit live RGB/temperature. A native fixture exposed an HSL syntax incompatibility with HeroUI's colour parser; the shared light colour output and four parser regressions cover it.
- Shared accessible sliders replace scene-only native sliders; the temperature track and colour controls work in both themes. New picker choices exclude hidden/disabled/configuration/diagnostic/service entries and internal segments, retaining independent outlets and existing draft targets. Accessories remain sorted by room and name.
- Native fixtures checked 1,440 px and 360 px layouts, local draft changes, exact colour values, keyboard slider commits, Escape dismissal and return of keyboard focus. A light-theme fixture confirms neutral foregrounds, a visible temperature gradient and reduced-motion animation disabled. Testing/applying and saving to the real home were disabled.
- With 20,000 synthetic clips, only 10–11 hit targets are mounted. Paused and idle-live samples have zero filmstrip rAF callbacks; playing runs 150 callbacks over 2.5 seconds while video and the displayed clock advance. Wheel previews preserve paused/playing intent, and scrubbing back from live resumes playback. No renderer errors in the completed run.
- Closing/opening a cover no longer retains a conflicting stored position/tilt; moving its position slider also keeps its target state consistent. Existing scene configurations are only changed when explicitly edited.
- A native cover editor fixture confirms Closed stores no old position/tilt, the slider reads 0%, a keyboard adjustment to 1% switches the draft back to Open, and the original 72% configuration remains unchanged. No renderer errors or real-home commands.
- A collapsed native viewport has zero frames and wakes with one frame when resized back to 700 px; the canvas is restored at its correct device-pixel resolution.
- Final local checks pass: 272 tests, TypeScript, lint, architecture, formatting and production build.
- Popover controls remain mounted through the exit animation so closing does not collapse the panel; closed popovers mount no controls. Native keyboard focus returns to the tile after dismissal.
- Final local regression and desktop validation are tracked with [PR #7](https://github.com/resonaura/haus/pull/7). Merge only after all platform/architecture jobs pass.
- Camera settings now call optional software analysis “Activity assist”: it supplements the camera’s motion sensor or works independently when none is available. The description retains pre-event footage and the default-off behavior.

## Follow-up: camera setup, full management and device reliability

- [ ] Activity assist placement: run analysis on the least-loaded available NVR cluster device, taking its capacity and resource pressure into account. If there are no NVR cluster devices, keep the feature visible and show a warning icon explaining that analysis runs on the Home Assistant device and can use significant resources. Also make unavailable/overloaded-node fallback clear; do not hide or silently enable the feature.
- [ ] Repair scene colour artwork using real scene payloads; diagnose why scene-applied Nixie backlight settings are ignored in its local add-on/integration. Preserve existing scenes and do not test lighting outside Narnia.
- [x] Aqara snapshots: retain the last successful frame on a transient fetch failure; declare snapshot offline only after roughly 30 seconds without usable stream/frame progress. Verify recovery and genuine prolonged outages.
- [ ] Measure the full camera-open path and reduce first-frame delay using bounded, privacy-aware preheated streams and reusable transports; compare Home camera recording/detection setup and document concrete choices.
- [x] New cameras default to Stream only. Set the user's four current cameras to Stream & record, retain default-off Activity assist, and expose understandable streaming/recording policies.
- [x] Add device begins with Camera / Other device. Camera setup offers existing/discovered integrations first, existing HA entities and an optional guided custom setup (RTSP stream, optional snapshot, optional microphone transport); validate capabilities and keep credentials private.
- [ ] Make integrations a complete management page: setup/reauth/repair, attention states, regional accounts and supported options. Investigate the user's Xiaomi attention issue without deleting regional configurations.
- [ ] Make add-ons a complete management page with lifecycle, configuration, logs, upgrades and backups where supported. Add native HACS management when installed, using supported capabilities and clear recovery paths.
- [ ] LAST: identify the actual kettle/protocol and develop a reliable HA/Haus integration or MQTT add-on with suitable water_heater semantics, richer controls, session/2FA recovery and tests. Repository creation is authorized. Never turn on heat during testing; the kettle may be empty.
- [ ] Run focused regressions and native UI checks, document deployment/recovery, then publish through a tested PR. Keep lighting and existing scenes/automations safe throughout.

### Current implementation and verification (2026-10-20)

- Scene HS now uses HA's HSV interpretation instead of HSL; pastel/white previews keep their real colour. Stored colour mode takes precedence over redundant attributes; dark scene artwork is dimmed. In-memory artwork/configs survive same-home reloads and are isolated by home/user. Focused colour/scene regressions pass.
- Camera fallback now loads on a separate muted video surface while RTC continues negotiating. HLS must advance through decoded frames before promotion. A synthetic delayed-RTC native fixture passes (fallback requested first, later RTC keeps playing, closure releases the peer). Real available cameras streamed with audio: Side ~2.8s, Guinea Pigs ~3.3s, Outdoor warm reopen ~3.5s; cold Outdoor ~7.2s. These are samples, not an instant-open guarantee.
- Short-lived, per-connection camera metadata cache and visible-preview prefetch added; credentials/SDP/streams are not retained in it. Cache/transport tests pass.
- Aqara snapshot grace and actual H264-to-JPEG + failed-capture preservation tests pass. PR #7 merged as ea00ec4. Version 1.6.9 published for both architectures and installed in HA with a backup; both Aqara cameras subsequently delivered moving, full-resolution video with received audio.
- Nixie scene command planning/whole-command serialization, effect+ON/OFF precedence and state memory have four regressions. PR #2 merged as e22e267; 1.3.10 images published. HA upgrade with backup completed; version 1.3.10 is started. No physical light test outside Narnia.
- Helper 0.3.3 PR #16 merged as 63321ee after all 69 tests and both architecture image builds passed. New cameras stream only; one-time migration preserves earlier cameras and opt-outs. Direct RTSP recording no longer bypasses bounded HA viewer manifest preheat. Superseded by deployed 0.3.4 below.
- Helper 0.3.4 PR #17 merged as 4822757 after all 71 tests and both architecture image builds passed, then installed in HA with a backup. Explicit RTMP target/URL-entity support validates local destinations, pins DNS resolution and redacts microphone credentials. Four existing cameras retain recording, software analysis remains OFF, and both real NVR nodes are online. A new 337,401-byte Haus configuration backup was retrieved from each node, checksum-verified, authenticated-decrypted and its archive contents checked. Earlier full HA archive recovery evidence remains valid; no restore was performed.
- Integrations/add-ons now have workspace detail pages. Camera/Other chooser, camera-brand filtering, manual RTSP/snapshot source or URL-entity selection, generic-camera validation/preview, camera naming/room assignment, precise regional reauth and native repair flow work are in progress. Native setup fixtures verify preview teardown, successful room/name/talk binding, retry without duplicate creation, and cancellation preserving discovered/reauth flows. StrictMode does not abort a transferred setup. Workspace integration/add-on pages and wide/narrow camera/scene editor views were inspected without real device mutations or renderer errors.
- Native HACS workspace now uses the installed integration’s real protocol for installed resources/updates/catalog, custom sources, releases, download/removal, beta options and critical notices. An isolated catalog of 4,668 resources mounts only 6–10 rows, including at a deep scroll offset; details and documentation are separate workspace pages. Real HACS reads and add-on configuration pages were inspected. Downloads/removals were not executed against the user’s home. Xiaomi currently has two loaded miot regional entries and no active reauth flow in the read-only snapshot. Do not remove either connection.
- Kettle remains LAST and untouched: discovered model xiaomi.kettle.v21. No heating or kettle commands issued.

- Live transport ownership is isolated in `useCameraLiveStream`. A warmed decoder can race RTC immediately; it must advance through actual frames before promotion, and the losing transport is closed. Startup is bounded and stale fallback work cannot replace a later winner. Native fixtures verify both late-RTC recovery and early warm-HLS promotion with audio enabled. After the add-on updates, real samples were Outdoor cold ~6.2s / warm reopen ~2.9s, Side ~1.6s (HLS with decoded audio), Guinea Pigs ~3.3s (RTC with audio). All three advanced through the subsequent playback observation; these are samples rather than an instant-open or no-outage guarantee. Narnia remains unavailable upstream.
- Full local suite passed with 286 tests when run with bounded workers. An unconstrained concurrent run exhausted available memory and produced timing failures; it is not counted as a functional verification result. Final local typecheck, lint, architecture, formatting, all 286 tests and production build pass. The packaged renderer also opened Outdoor at 2688×1520 with advancing RTC video and received audio, without renderer errors. Cloud desktop/architecture checks for this batch remain pending. Activity assist resource-aware placement/warning above remains a separate, uncompleted task.
