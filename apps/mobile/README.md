# Haus Mobile

Haus Mobile is the iOS and Android app in the Haus workspace. It uses Expo Router and imports shared behavior from `@haus/core`; its React Native dependencies stay separate from the Electron app.

Run these commands from the repository root:

```sh
pnpm mobile
pnpm mobile:ios
pnpm mobile:android
```

The current screen is intentionally empty of sample devices. The mobile persistence adapter stores HA sessions in the platform secure store and versioned, session-scoped snapshots in encrypted MMKV. Native MMKV requires a development build rather than Expo Go.

Build and run a native development client with `pnpm mobile:run:ios` or `pnpm mobile:run:android`; these commands generate the platform projects through Expo Continuous Native Generation.
