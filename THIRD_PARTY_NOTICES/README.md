# Third-party notices

Haus-authored code is licensed under GPL-3.0-or-later except `packages/kitsune`, whose independently authored compatibility layer and extracted vendor adapters are GPL-3.0-only. These notices apply to the identified third-party code, assets, and adaptations; the root license does not replace their original licenses.

- **Home Assistant JavaScript WebSocket client** (`home-assistant-js-websocket` 9.8.1): Apache-2.0. Its complete upstream license is included as `HomeAssistant-JS-WebSocket-Apache-2.0.txt`. Haus uses the client to communicate with Home Assistant; Home Assistant Core itself is not copied into this repository.
- **OpenCV Zoo NanoDet** source and model: Apache-2.0. See `apps/node/vision/LICENSE-OpenCV-Zoo` and `apps/node/vision/NOTICE.md`.
- **Material Symbols**: Apache-2.0. See `Material-Symbols-Apache-2.0.txt`.
- **Haus custom brand icons**: MIT. See `Custom-Brand-Icons-MIT.txt`.
- **DuoBar usage arc geometry adaptation**: MIT. See `DuoBar.txt`.
- **Expo template material retained in the mobile app**: MIT. See `Expo-Template-MIT.txt`.
- **HAP-NodeJS** (`@homebridge/hap-nodejs` 2.3.0): Apache-2.0. The upstream license ships with Helper/NVR runtime dependencies. Haus uses the library directly, without a Homebridge server.
- **Ciao** (`@homebridge/ciao` 1.4.0): MIT. Its upstream license ships with the NVR runtime dependency.
- **Optional Miku server icon**: artwork by Granjita, CC0 1.0, with the character-use context recorded in `Miku-Server-Icon-Attribution.md`.

Bundled npm and operating-system dependencies keep the license notices shipped by their respective upstream packages.
