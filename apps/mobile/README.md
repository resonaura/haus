# Haus Mobile

Haus Mobile (`@haus/mobile`) is the iOS and Android client in the Haus workspace. It uses Expo Router and shares domain, optimistic state, and presentation logic from `@haus/core`, `@haus/state`, and `@haus/ui`, keeping React Native dependencies separate from the Electron desktop app.

Run from the repository root:

```sh
pnpm mobile
pnpm mobile:ios
pnpm mobile:android
```

## Architecture & sessions

- **Hub-first discovery:** Local discovery scans for Haus Hubs (`_haus._tcp`) by default, with manual address fallback and an explicit opt-in path for importing or connecting to an external Home Assistant instance.
- **Shared domain model:** Devices, rooms, light grouping, service-device filtering, and state formatting reuse `@haus/core` and `@haus/state`.
- **Secure offline caching:** Hub sessions, pairing grants, and cache keys live in platform secure storage; encrypted, session-scoped MMKV retains the last home layout offline without replacing it with demo data while loading. Native MMKV requires a development build rather than Expo Go.
- **Workspace resolution:** Metro uses Expo's automatic workspace configuration with a resolver for relative NodeNext `.js` imports inside the shared TypeScript source packages.

Build and run a native development client with `pnpm mobile:run:ios` or `pnpm mobile:run:android` (Expo Continuous Native Generation).
