# UX and performance audit — 18 October 2026

The review keeps the existing dark neutral surfaces, native sidebar materials, restrained borders, actual light colours and camera-first overview. This pass improves interaction and code ownership without replacing the visual system.

## Fixed in this pass

| Finding                                                                                                 | Change                                                                                                                       | Verification                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Spotlight also filtered the page behind its overlay, unmounting overview content while typing           | Separate overlay query from the page's device selection                                                                      | Entering a room query retains the Cameras heading and changes only search results                       |
| Spotlight could lose its selected result after an empty search; focus could reach the underlying page   | Clamp result selection, contain keyboard focus, restore focus to the search trigger and scroll the selected result into view | Empty query → no matches → valid room query; Shift+Tab stays inside; Escape restores trigger focus      |
| Web device context menus did not support a complete keyboard flow                                       | Shared nested menu with arrows, Home/End, Escape and focus restoration                                                       | Open Move to Room using ArrowRight and dismiss without changing a device                                |
| The room icon picker had multiple inferred selections and “Automatic” could resolve to the generic icon | One explicit selection, correct automatic resolution and keyboard movement                                                   | One checked menu item, arrow navigation, Escape returns focus                                           |
| The compact add-device button hid its text without providing an accessible name                         | Explicit action label independent of responsive text visibility                                                              | Accessible button name remains available when the icon stands alone                                     |
| Dragging a tile updated state owned by the whole app                                                    | Move drag and reorder preview state into each grid                                                                           | Existing scoped ordering and grouping tests retained; no device commands added                          |
| Main bundle included video playback and management code before those screens were opened                | Deferred feature modules; split camera cards from the player                                                                 | Main entry reduced from roughly 3.18 MB to 1.27 MB in production output; HLS/player is a separate chunk |
| Camera cards refreshed even when far outside the viewport                                               | Visibility-aware polling with a small prefetch margin                                                                        | Last decoded frame retained; existing page-visibility checks retained                                   |
| Every observed DOM change could rescan dialogs for sidebar materials                                    | Coalesce material checks to one animation frame                                                                              | Native material behavior retained; cleanup cancels pending scans                                        |
| Unrelated screens and style overrides were concentrated in large files                                  | Feature folders, shared controls and SCSS partials with explicit order                                                       | Type checks, build, model regressions and compiled-cascade comparison                                   |

The Home room stream also no longer repeats scenes as small Hue-badged chips. Scenes remain in the main scene rail and inside each room.

## Remaining product work

- The app shell still coordinates several route views. Continue extracting a route when changing its behavior; do not introduce a large untyped context merely to hide dependencies.
- The SCSS preserves historical refinement layers. Merge conflicting declarations in a dedicated visual pass, checking light/dark, native materials, reduced transparency and compact windows together.
- Scene library rails can still mount many cards. Profile a large scene collection and add horizontal virtualization if card count or image decoding becomes a measurable cost.
- Camera snapshot, live video, recordings and “offline” intervals need distinct provenance. A reachable snapshot endpoint may serve an image that itself says the stream is offline; a fresh HTTP response is not proof of a fresh camera frame.
- A native scene/automation editor remains a product gap. The automation page currently hands editing off to Home Assistant; do not present it as a complete local editor.
- Device management needs a coherent bulk workflow: select devices, review room changes, confirm naming, and show partial failures without hiding successful changes.
- Keep individual-device statistics and printer consumables close to the device, using explicit last-known timestamps when offline.

## Review scope

Automated checks cover normalization, optimistic state, scene visibility, grouping, ordering, camera history and the extracted home selectors. Browser interaction checks use the demo home. Live-home inspection is read-only; no real device or scene commands are needed for this refactor. Cross-platform packages can compile in CI, while native material behavior still requires visual checks on each operating system.

Keyboard behavior follows the [WAI modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Performance choices follow [Electron's guidance](https://www.electronjs.org/docs/latest/tutorial/performance); bundle-size changes are not a claim about measured startup time or memory usage.
