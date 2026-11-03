# Haus Mobile

Haus Mobile is the iOS and Android app in the Haus workspace. It uses Expo Router and imports shared behavior from `@haus/core`; its React Native dependencies stay separate from the Electron app.

Run these commands from the repository root:

```sh
pnpm mobile
pnpm mobile:ios
pnpm mobile:android
```

The Home screen restores the real cached home immediately and reconciles it with Home Assistant. Devices, room/light grouping, service-device filtering and state formatting use the same strict core model as the desktop. Home visibility, favorites and saved room order come from the current Helper layout through user-bound HA ingress; encrypted, session-scoped MMKV retains the last layout offline. Layout polling pauses in the background. The current mobile layout is read-only; card commands, native media and direct cluster transport are subsequent increments.

HA sessions and the cache key live in the platform secure store. Native MMKV requires a development build rather than Expo Go. No demo devices replace the user's home while it loads.

Metro uses Expo's automatic workspace configuration with a resolver for relative NodeNext `.js` imports inside the shared TypeScript source packages. Node/Electron keep their normal emitted ESM paths.

Build and run a native development client with `pnpm mobile:run:ios` or `pnpm mobile:run:android`; these commands generate the platform projects through Expo Continuous Native Generation.
