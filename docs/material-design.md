# Shape, Liquid Glass and material decisions

References: Apple HIG [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons), [Icon Composer](https://developer.apple.com/icon-composer/), and WWDC25 [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) / [App icons](https://developer.apple.com/videos/play/wwdc2025/220/).

## Native window & analytical Liquid Glass surfaces

- **Native shell materials:** macOS uses native `NSGlassEffectView` where supported (vibrancy fallback on earlier versions); Windows uses native acrylic/blur; Linux enables sidebar transparency only when the active desktop compositor reports blur enabled (GNOME YuzuOS / Blur my Shell, KDE KWin Blur, Hyprland).
- **Analytical 9-slice rim lighting:** Cards, modals, dialogs, floating docks, popovers, tabs, and circular controls share the exact continuous-corner superellipse SDF specular crest and 8pt inner diffuse bloom from `@haus/icons` (`components/ui/glass-rim-lighting.ts` + `styles/design/_glass-rim.scss`). Rim overlays stay subtle and translucent (`0.48–0.76` resting opacity) so contours frame glass surfaces without harsh glare.
- **Color- and effect-adaptive contours:** Active device tiles (`.accessory-tile.is-active`) and active device controller modals (`.haus-device-modal[data-active]`) apply the 9-slice `--glass-rim-card` / `--glass-rim-panel` texture as an alpha mask (`-webkit-mask-box-image` / `mask-border`). Its luminous fill adapts smoothly to `--device-color` (cross-fading via `@property --device-color`) and, when a light effect (`[data-light-effect]`) is active, blends `--effect-c1`, `--effect-c2`, and `--effect-c3` with synchronized zero-translation rim animations (`flicker`, `pulse`, `rainbow`, `aurora`, `wave`, `sparkle`, `beat`).
- **Continuous geometry:** `styles/materials.scss` defines shared continuous-corner tokens (`corner-shape: superellipse(1.4)` with rounded-corner fallback), concentric inset radii, and accessibility overrides (`prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast`, `forced-colors`).

## Brand & integration icons

- `@haus/icons` renders unified squircle/superellipse brand tiles through a persistent C++20 worker (`haus-icon-worker`, transparent TypeScript fallback) with versioned cache invalidation across Hub and Desktop.
- Vector artwork stays vector; bitmap separation runs at bounded source resolution (`<= 1024 px`) with distinct plate, rim, and foreground silhouette lighting.

## Home layout, tiles and radar discovery

- **Category dock & virtualized stream:** `HomeCategoryDock` floats above scrolling content with three progressively masked blur bands and horizontal scroll shadows. The device stream uses TanStack Virtual to mount visible room/category sections plus overscan without breaking shared page scrolling.
- **Tile illumination & ordering:** Device tiles pair an unmasked color-wash `::before` layer with the masked Liquid Glass contour `::after` layer. Favorites and explicit drag order lead; everyday controls precede passive sensors and infrastructure. In the Lights "On Now" view, user-toggled lamps hold in place for a short 4-second departure grace window so accidental clicks can be reversed before the grid reflows.
- **Unified Add Device radar modal:** Adding a device opens a spacious HeroUI modal featuring an interactive ambient discovery radar alongside immediate discovered-device cards (with uniform badge sizing), QR/PIN pairing, camera onboarding, and integration search. Integration cards align cleanly to uniform grid heights.

## Optimistic feedback, lights and cameras

- **Optimistic overlay:** Mutations flow through a shared optimistic queue with per-entity serialization and quiet 6-second pending feedback. Light prediction retains the last confirmed color, brightness, and Kelvin temperature per home so off-state attributes never flash to neutral white.
- **Camera cards & timeline:** Camera snapshots refresh every 10 seconds while visible without overlapping requests, preserving the last real frame and snapshot age across transient errors. Recording playback uses a persistent `requestAnimationFrame` clock over virtualized clip pages and bounded thumbnail decoding.
- **Device controllers:** Device and light-group modals use frosted continuous-corner panels with adaptive contours, contextual glyphs, and sticky glass tabs while keeping inputs interactive during live updates.
