# Haus product and reliability plan

Last updated: 2026-10-19. Work sequentially; no subagents.

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
- [x] Install Aqara 1.6.8 and helper 0.2.4. Both Aqara cameras deliver actual high-resolution frames (2688×1520, 2304×1296).
- [x] Real full HA backup completed: encrypted archive 1,396,080,743 bytes, available after restart; automatic HA backups enabled and verified.
- [x] Public NVR Docker image 0.1.0, amd64/arm64; real x64 hardened-container and persistence checks. No production node paired yet.
- [ ] Merge current Haus PR #4 after checks on its latest commit; keep dev app running for review.

## 1. Recordings, audio and streaming reliability (first)

- [ ] Inspect every existing recording, not a sample: decode/container integrity, video/audio tracks, media timing, frame gaps, repeated segments, duration and seek behavior. Save a redacted persistent report and counts.
- [ ] Establish each live camera's actual audio capability. Enable audio recording where available; preserve audio through all ingest, concat, conversion, relay and playback paths. Report source audio absence rather than fabricate sound.
- [ ] Fix recorder liveness, reconnects, stalled FFmpeg, cancellation, source cadence and gap handling with bounded resource use. Preserve originals when repairing compatible playback copies.
- [ ] Strengthen helper/NVR stream preheat and app leases, deduplication, battery/privacy/offline handling, reconnects and cache limits. No microphone outside explicit Talk.
- [ ] Verify actual stored settings + shared preferences round trip, backups, HA registry coverage and helper features; add missing fields intentionally.

## 2. Camera experience

- [ ] Default video fit = cover/fill; toggle to contain; contain mode gets low-resolution canvas ambilight, smooth and bounded, visibility/reduced-motion aware.
- [ ] Repair fullscreen on the complete viewer (including controls/history). Remove download and refresh from the camera modal toolbar.
- [ ] Always cache the last camera image per home/camera with bounded private storage; blurred last frame while loading, smooth decoded replacement. Cover dashboard and viewer.
- [ ] Attractive capability-based camera sliders, including spotlight color/temperature/brightness and camera parameter sliders.
- [ ] Talk active waveform bars following the local scrypted-tuya reference, with actual microphone amplitude and cleanup.
- [ ] Confirm cross-day calendar and scrub semantics, error layout and audio after real helper update.

## 3. Inventory: inspect every real HA entity/device/room

- [ ] Save a private inventory audit; classify physical, diagnostic, configuration, virtual, duplicates, security, buttons/remotes, network and physical hubs.
- [ ] Hide service-only entities/rooms; retain physical hubs in their actual rooms. Restore missing security devices and appropriate open/closed/motion/vibration icons.
- [ ] Include Hue button/remotes; show actual keys and linked automations without treating stateless buttons as switches.
- [ ] Merge Nixie/Nixie Clock related entities into their parent; review camera MQTT relations and spotlight attachment.
- [ ] Assign sensible default icons for every real room, keeping user overrides; hide service rooms.
- [ ] Network/eero cards and modal: actual connectivity, clients, WAN/mesh and health capabilities with truthful unavailable states.

## 4. Device and editor design

- [ ] Apple TV clear brand logo, wider media modal, actual virtual remote if HA exposes remote services. Google/HomePod/Fire TV model-aware artwork.
- [ ] Power-strip icon + large circular per-outlet power controls with labels; independent outlet state and optimistic feedback.
- [ ] Modernize climate/temperature sensor modals: remove legacy colors, reuse neutral controls.
- [ ] Repair scene-editor tiles and responsive layouts, preserving drafts/existing scenes and making explicit tests safe.
- [ ] Clean integrations page: consistent artwork, sections, loading/errors, actions and actual integration flows.
- [ ] Review neglected areas and improve hierarchy, motion and accessibility where useful; no gratuitous rewrites.

## 5. Finish

- [ ] Meaningful regression checks, full app/helper tests + builds; real decoded playback and all-recording report; resource/performance review.
- [ ] Review fresh UI at wide/narrow sizes; cleanup fixtures, streams and temporary files; preserve development server.
- [ ] Publish approved changes, wait for CI, merge and deploy helper safely; confirm versions, automatic backup setting and retained archive.
- [ ] Report remaining source/device/hardware limitations accurately. Narnia Tuya source was unavailable at last check.
