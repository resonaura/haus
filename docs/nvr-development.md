# Camera playback, NVR and recovery

The [Haus Hub](../apps/hub) owns the full server runtime and optional storage/media roles. Existing NVR and explicit HA appliance image aliases build from the same Dockerfile with separate targets. See [upgrade and acceptance requirements](../apps/hub/docs/upgrade.md); normal standalone operation does not require HA or a second Hub.

## Timeline

The live filmstrip spans all retained days, loading 100-clip pages in either direction. Calendar navigation positions the history without limiting subsequent scrolling to that date. The same rAF that updates the playback clock changes the calendar date when a clip crosses into another day. Indexed day markers use the desktop’s local midnight boundaries, including daylight-saving changes; they do not require downloading every clip. The overlay keeps the same height when history is empty and shows no empty-state text.

- One persistent rAF scheduler reads the actual media clock; React time updates do not recreate the loop. Waiting/seeking does not extrapolate playback beyond the media element.
- Layout/ID indexes are built when clips change. Visible ranges use binary search. Only the viewport and small overscan are drawn/mounted; the canvas never grows to the width of the whole history.
- Prepending an earlier page preserves the visible anchor. Pointer scrubbing is coalesced, and live idle sits at the newest edge. Reduced motion and page visibility are respected.
- Thumbnails use four decoder slots and a 64-entry cache. Supported Chromium builds crop/resize them into small ImageBitmaps; evicted/disposed bitmaps are closed. Images fade into the strip without requesting every clip.
- Events thumbnails are virtualized too; the day ruler uses a bounded canvas rather than a button per clip.

An isolated Electron fixture with 100,000 clips mounted at most 18 hit targets. Its rAF was never cancelled by parent React updates, a stalled media clock produced zero scroll drift, and prepending 500 entries moved the scroll origin by exactly 45,500 px. In that run p95 callback work was 2.2 ms and p95 callback spacing was 17.6 ms. This is a local synthetic benchmark, not a guarantee of frame rate on every machine or with arbitrary video/GPU load. The temporary fixture was removed after testing.

## Playback and warming

An existing local recording inspected with ffprobe had timestamp gaps up to 3.113 seconds. Compatibility output uses a regular 20 fps cadence, two-second GOPs, no B-frames, AAC resampling and fast-start MP4. Concatenation manifests explicitly state each segment's media duration. Legacy originals are preserved; generated copies carry a playback version and source-gap diagnostics. Missing source frames are held with their timing rather than reconstructed, and the Events UI explains known source gaps.

Haus Hub permits one encoder at a time, with bounded backlog and foreground promotion. Preparing the next clip is low priority. Warming keeps at most two recently opened cameras; idle leases expire after 45 seconds, heartbeat leases after client loss are bounded, and battery-associated cameras release the warm lease immediately on close. Existing recording buffers are reused; no background video decoder or computer microphone is started by warming.

Optional NVR live relays pull a short-lived, camera-specific Hub capability. Normal recording streaming requires no inbound relay port: Electron receives a short-lived, single-file grant and fetches ranges directly, falling back to the coordinator Hub if the worker cannot serve the request. Playback never returns a stored pairing key or token to the renderer. Recovery-kit export uses a private native save dialog and never exposes key material to the renderer. Media responses through Electron avoid cross-session HTTP caching, and home changes abort outstanding requests and release warm leases.

## Hubs, NVR roles and recovery

`apps/hub` contains the unified NestJS TypeScript runtime, shared [Dockerfile](../apps/hub/Dockerfile), Compose profiles, local protocol tests and recovery CLI. [Storage/media role documentation](../apps/hub/docs/nvr.md) describes pairing and optional live relays. Image aliases remain published at `ghcr.io/resonaura/haus/nvr` (`haus-nvr-v*` tags) alongside standalone Hub deployments.

The coordinator Hub remains authoritative for configuration using compare-and-swap revisions and per-field client changes; home-scoped caches retain offline edits. Favorites, visibility, room icons, grouping and device order are shared; appearance, usage counters and predicted-light caches stay local. Worker Hubs receive encrypted configuration snapshots and archives rather than direct write access to home configuration.

Each connected NVR Hub receives encrypted recovery copies. Video normally gets up to two worker placements, guided by existing placements and free space. Hash verification, atomic file commits, instance identity, request signatures/nonces, disk reserves and bounded transfers protect replication. A replaced disk invalidates stale acknowledgements; offline/paused nodes do not delete originals.

Backups retain 24 Haus configuration versions and 7 full archives. Haus snapshots run hourly and after settled configuration changes. A hot-backup hook captures SQLite consistently while its WAL remains live, excluding local private vaults/keys and camera media buffers. The recovery kit is an explicit admin-only export; decryption authenticates the full archive before writing output and never restores a running system automatically.

## Eufy talk

The Eufy adapter (`packages/kitsune`) follows the local Eufy Security WebSocket protocol: exact registered device identity, `device.has_command` capability, schema negotiation, owned livestream startup, confirmed talkback start and mono 16 kHz AAC/ADTS. It stops only sessions it started. External installations can configure a private WebSocket address explicitly; RTSP alone is not treated as proof of talk support. Audio POST requests stream directly rather than buffering the full microphone payload.

## Validation notes

Unit and integration suites run via `pnpm check` and `pnpm check:apps` against synthetic loopback streams and audio/video fixtures (covering encrypted archive replication, multi-placement recording, scoped range playback, HomeKit/HKSV unsigned 32-bit SRTP SSRC delivery, authenticated recovery exports, concurrent warm-slot replacement, and relay cancellation). Physical camera/speaker behavior and multi-machine failover remain separately verified hardware checks.

Primary references: [media-clock callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback), [rAF](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame), [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html).

## Camera and desktop refinements

The GPUIX preview uses the desktop Hub HLS transport and keeps its authenticated requests in the app. A per-viewer loopback relay accepts only relative HLS asset names. `@haus/media` decodes the stream and the shared `VideoSurface` uploads BGRA frames through GPUIX. Closing the app cancels its camera viewers, stops their decoders, and waits for warm lease release before disposing the Hub session owner. Hub expiry still bounds leases when the network is unavailable. The native phase still needs recordings, camera audio, and WebRTC-only sources.

A native decoder that stops delivering frames is cancelled. Once playback has started, the camera view makes up to three consecutive restart attempts with backoff and reuses its warm owner. The retry budget resets after 30 seconds of stable playback. Closing the view cancels pending restarts.

Follow mode keeps a floating canvas position separately from the browser's rounded scroll position. A user gesture owns native scrolling without easing; it previews the current frame at a bounded seek cadence, then restores the pre-gesture playback intent. Live and playing recordings resume; an explicit pause remains paused. A 100,000-clip gesture fixture kept at most 15 hit targets, performed 8 seeks during a 720 ms wheel gesture, rendered subpixel follow positions and had zero position drift after release. Consecutive offline observations without footage between them collapse into one translucent card, while the Events ruler keeps the underlying intervals.

The camera viewer fills the dialog with video and overlays its controls. Audio starts enabled, and separate WebRTC tracks are collected into one stream. The dialog reserves the window-control area. Wide and 900 px fixture reviews checked full video bounds, a compact toolbar, empty history and the single offline card. Scene editing now uses named device states, room-grouped accessory tiles, capability-based adjustments and a draft preview; applying a test is an explicit user action. No real scene was tested or overwritten in this pass.

Appearance defaults to the operating system, with explicit light/dark choices retained in Settings. Mac controls remain native. Linux uses functional traffic lights only when GNOME reports Kiwi active with app buttons enabled; other Linux sessions get a separate caption rail. Windows keeps native caption controls and acrylic, with a Windows 11 corner hint. Windows 10 keeps its blur path without imposing a conflicting shaped region. Native Windows appearance and a live GNOME desktop still need visual hardware testing; the current Linux NVR host has no active Shell DBus service.

Platform references: [Electron custom title bars and safe areas](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar), [rounded-window support](https://www.electronjs.org/docs/latest/api/base-window), [Windows DWM corner preference](https://learn.microsoft.com/windows/win32/api/dwmapi/ne-dwmapi-dwm_window_corner_preference), [GNOME extension query implementation](https://github.com/GNOME/gnome-shell/blob/main/js/ui/shellDBus.js), [Kiwi settings](https://github.com/kem-a/kiwi-kemma/blob/main/schemas/org.gnome.shell.extensions.kiwi.gschema.xml).

The history clock uses the same persistent rAF as the filmstrip and reads the media element directly. An isolated Electron fixture advanced from 03:00:00 to 03:00:02 without React playback updates. The 100,000-clip gesture fixture mounted at most 15 hit targets and stayed pinned after scrolling settled.

A read-only RTSP probe found an existing stalled Aqara tunnel. Restarting only that camera’s P2P stream restored video; both installed streams then delivered frames at their full observed resolutions. [Aqara recovery](https://github.com/resonaura/aqara-g5pro-mqtt) 1.6.8 is tested with disposable data, H264/HEVC offline encoders, native worker hangs, manual cancellation and RTP clock handovers (83 Node tests and two native checks). Its watchdog also detects missing completed video frames when encrypted packets continue arriving.

The real helper 0.2.3 background-backup cycle completed a 1,396,080,743-byte encrypted HA archive. It remained available after a helper restart; automatic daily HA backups were re-enabled and read back as enabled. The native Supervisor archives created during validation were preserved.

Sidebar cleanup retains its WebContents reference before the native window closes, so disposal does not access Electron’s destroyed BrowserWindow getter. The regression check destroys that getter before cleanup and verifies repeated disposal remains safe.

The calendar animates entry, dismissal and month changes without replacing the focused grid, and respects reduced motion. Future dates stay disabled and dim without strikethrough. A native media fixture verified live→play, playing→play and paused→paused scrubbing, decoded paused frames, and a centered error with a matching retry-button color.
