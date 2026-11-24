# Third-party notices

Haus-authored code is licensed under GPL-3.0-or-later except `packages/kitsune`, whose independently authored compatibility layer and extracted vendor adapters are GPL-3.0-only. These notices apply to the identified third-party code, assets, and adaptations; the root license does not replace their original licenses.

- **Home Assistant JavaScript WebSocket client** (`home-assistant-js-websocket` 9.8.1): Apache-2.0. Its complete upstream license is included as `HomeAssistant-JS-WebSocket-Apache-2.0.txt`. Haus uses the client to communicate with Home Assistant; Home Assistant Core itself is not copied into this repository.
- **OpenCV Zoo NanoDet** source and model: Apache-2.0. See `packages/ai/vision/LICENSE-OpenCV-Zoo` and `packages/ai/vision/NOTICE.md`.
- **Material Symbols**: Apache-2.0. See `Material-Symbols-Apache-2.0.txt`.
- **Haus custom brand icons**: MIT. See `Custom-Brand-Icons-MIT.txt`.
- **DuoBar usage arc geometry adaptation**: MIT. See `DuoBar.txt`.
- **Expo template material retained in the mobile app**: MIT. See `Expo-Template-MIT.txt`.
- **HAP-NodeJS** (`@homebridge/hap-nodejs` 2.3.0): Apache-2.0. The upstream license ships with Helper/NVR runtime dependencies. Haus uses the library directly, without a Homebridge server.
- **Ciao** (`@homebridge/ciao` 1.4.0): MIT. Its upstream license ships with the NVR runtime dependency.
- **Optional Miku server icon**: artwork by Granjita, CC0 1.0, with the character-use context recorded in `Miku-Server-Icon-Attribution.md`.
- **GPUIX** (`remorses/gpuix`, pinned base `0ce4f41fca8ffb9c18fd1efd2631f0f4b97a1abf`): Apache-2.0. Reproduced via `packages/gpui/scripts/fork.ts` and `packages/gpui/patches/gpuix/`.
- **Minimal standalone GPUI runtime workspace** (`remorses/zed` branch `gpuix`, pinned base `f77e5cfe9dad04288566f00c66ecf3c58d6f84b3`, extracted to the 27-crate cross-platform GPUI closure under `packages/gpui/vendor/gpui` via `packages/gpui/scripts/prune-workspace.ts` — excluding Zed editor, AI, LSP, collab, and debugger components — plus selective scroll-axis locking adaptation from `zed-industries/zed` PR `#61797`): Apache-2.0 / GPL-3.0-or-later as carried in `packages/gpui/vendor/gpui/LICENSE-APACHE` and `LICENSE-GPL` (with bundled `assets/fonts/ibm-plex-sans/license.txt` and `assets/fonts/lilex/OFL.txt`).
- **Sonora GPUI** (`sonorahq/gpui`, pinned reference `e5766e772ee939b741456eeec22dbe6764fafcdd` for layer compositor, blur passes, custom WGSL shaders, frame pacing, layout/view caching, squircles, spread shadow growth, and SVG tile padding): Apache-2.0 / GPL-3.0-or-later as carried in upstream notices.

Bundled npm and operating-system dependencies keep the license notices shipped by their respective upstream packages.
