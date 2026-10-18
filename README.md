# Haus

A desktop home for your rooms, cameras and everyday controls. Built with Electron, React and HeroUI, connected locally to Home Assistant.

## Your home, a little closer

- Cameras first, with live WebRTC/HLS, smooth snapshot refreshes and snapshot age.
- A whole-home device stream with category lenses, room controls and virtualized sections.
- Actual light output colors, capability-aware controls, optional grouping of numbered lights, and stable device positions.
- Shared optimistic updates with remembered light output, confirmation, ordered commands and rollback on failure.
- Scenes grouped by room, source badges, active-state indication, Hue palettes and independent Home/app visibility.
- Integrations, device setup flows, add-on management and sensor history.
- Persistent home notifications, software updates and Repairs in the notification feed.
- Local camera event recordings and a timeline through [Haus helper](https://github.com/resonaura/haus-helper).
- Native Liquid Glass for the macOS sidebar when supported, vibrancy on earlier macOS releases, with accessible web materials for content.

Authentication stays in Electron's main process, backed by OS-encrypted storage. Renderer APIs validate their operations; OAuth credentials never enter the UI. The browser preview uses a sample home and does not connect to your real devices.

## Develop

Node 24 and pnpm 11 are recommended.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

For the isolated sample home in a browser:

```sh
pnpm dev:web
```

```sh
pnpm check
pnpm build
pnpm package
```

## Builds

GitHub Actions checks and packages macOS Apple silicon and Intel, Windows, and Linux builds. Linux releases include AppImage, Debian, RPM, Arch/pacman, and portable tar.gz packages. macOS includes DMG and PKG installers; Windows includes an interactive installer. Build artifacts are available on each successful workflow run. Pushing a `v*` tag publishes a GitHub release. Haus uses no paid Apple Developer ID or notarization: the app bundle is ad-hoc signed and the PKG installer is unsigned.

See [desktop installation notes](docs/platforms.md) for NixOS, KDE, Hyprland, macOS quarantine, and Homebrew setup.

Install the **Haus** app from the `haus-helper` Home Assistant repository to enable event recording. Camera discovery, sensor binding, media and storage all remain local; the GitHub builds contain application code only.
