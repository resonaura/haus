# Haus architecture

Haus is a standalone smart home monorepo built around a single NestJS server (`apps/hub`), native desktop (`apps/desktop`) and mobile (`apps/mobile`) clients, and 17 shared TypeScript ESM packages (`packages/*`).

See [platform architecture](architecture/platform.md) for cross-package ownership, single-writer invariants, and protocol boundaries.

## Desktop structure (`apps/desktop`)

Haus Desktop maintains strict Electron main/preload/renderer separation and a feature-based React renderer.

```text
apps/desktop/src/
  main/                  Hub session/transport, discovery, media/recordings bridge, platform materials, secure storage
  preload/               Narrow context-isolated native API (`window.hausNative`)
  shared/native.ts       Main/preload/renderer contracts
  renderer/src/
    app/                 Composition, navigation, deferred feature entry points, shell
    features/
      home/              Overview composition, category dock, and memoized view selectors
      devices/           Accessory tiles, grids, device controller sheets, actions, On Now departure grace
      cameras/           Snapshot cards, live WebRTC/HLS player, canvas recording timeline, settings
      scenes/            Scene collection, room presentation, and draft preview
      rooms/             Room-specific layout and presentation preferences
      connections/       Integrations, Add Device radar discovery flow, inventory, and options/reauth flows
      commissioning/     QR/PIN code-first pairing flows (Matter, HomeKit, Improv, Wi-Fi)
      pairing/           Hub discovery and authenticated pairing sheets
      apps/              Managed Haus Apps catalog, install progress, config, and logs
      community/         HACS repositories, details, and installation flows
      automations/       Local automation list, triggers, and execution controls
      editors/           Configuration and YAML/JSON editors
      servers/           Multi-hub servers, telemetry, backups, cluster management, live E2EE terminal
      notifications/     Attention center, repairs, and firmware/app updates
      statistics/        Recorded sensor and device time-series history
      search/            Spotlight overlay
      settings/          Preferences, appearance, and connection settings
    components/
      ui/                Shared UI primitives, Liquid Glass 9-slice rim runtime (`glass-rim-lighting.ts`)
      forms/             Reusable schema and JSON fields
      icons/             Device, state, and room icon rendering
      brand/             Integration and brand icon surface with hub-backed cache
    hooks/               Shared browser/native lifecycle, coalescing, and session hooks
    model/               Pure domain types, normalization, optimistic state, selectors, and departure grace
    ha/                  Adapter helpers for optional external HA connections
    styles/              Explicitly ordered global SCSS (`index.scss`, `materials.scss`, `design/_glass-rim.scss`)
```

## Dependency direction

- `packages/core` owns platform-neutral domain types, identities, readable addresses (`type::area:device:entity`), commands, receipts, sessions, auth, and ports. It has zero HA, Docker, Electron, Homebridge, Scrypted, or OS imports.
- `packages/state` provides the selector-based Zustand vanilla store with optimistic overlay and reconciliation over neutral contracts.
- Adapters (`packages/mqtt`, `packages/matter`, `packages/zigbee`, `packages/thread`, `packages/homekit`, `packages/kitsune`, `packages/apps`, `packages/media`, `packages/ai`, `packages/bridge`, `packages/servers`, `packages/ipc`, `packages/icons`, and optional `packages/ha`) implement core ports and never import app code.
- Inside the desktop renderer: `app` composes `features`; `components` may import `model` types but never `app` or `features`; `model` has no React, DOM, or native dependencies; native capabilities pass strictly through `window.hausNative` with credentials confined to main.

`pnpm architecture:check` and `pnpm rules:check` enforce these boundaries, file length ceilings (`<= 500` lines), directory cleanliness (`<= 25` files/dir), and license provenance. Both run as part of `pnpm check`.

## State, optimistic actions, and rendering

- `useHaus` is the session and transport boundary owning optimistic predictions, per-entity command serialization, light output memory, and reconciliation. Feature actions dispatch through that queue rather than creating parallel command streams.
- `buildHomeView` / `useHomeView` derive room membership, camera ownership, visibility, and scene placement from snapshots without duplicating derived lists in state.
- Heavy screens and controller sheets load through module-level `React.lazy` declarations so camera cards remain lightweight while HLS/WebRTC playback and timeline history load on demand.
- Snapshot cards pause polling outside the viewport while keeping the last decoded frame and snapshot age visible.

## Styles and Liquid Glass materials

- `styles/vendor.css` imports Tailwind v4 and HeroUI v3 outside Sass. All authored Haus styles live in global SCSS loaded in explicit order from `styles/index.scss`.
- Analytical Liquid Glass 9-slice rim lighting (`components/ui/glass-rim-lighting.ts` + `styles/design/_glass-rim.scss`) shares the exact continuous-corner superellipse SDF model with `@haus/icons`. Active device tiles and controller modals apply the 9-slice rim as an alpha mask (`-webkit-mask-box-image` / `mask-border`) so specular contours adapt to `--device-color` and multi-color `[data-light-effect]` palettes.

## Shared workspace & server runtime

- `apps/hub` (`@haus/hub`) is the unified NestJS server application built from a single [Dockerfile](../apps/hub/Dockerfile) (`hub` default target, `addon` explicit legacy HA appliance target). It owns local persistence via TypeORM (`better-sqlite3` with explicit migrations), the native MQTT broker, radio controllers, Kitsune isolated runtimes (`ha-flow`, HACS, Homebridge, Scrypted), HomeKit/HKSV publication, local NVR/recording/AI roles, and host telemetry.
- `packages/icons` compiles both TypeScript ESM and the persistent C++20 `haus-icon-worker` (`dist/haus-icon-worker`).
- `packages/media` owns all FFmpeg/ffprobe invocation, recording/streaming profiles, SRTP/HKSV, and the native C++ camera media engine; consumers inject `MediaRuntime` from composition roots.
- `custom_components/haus` remains a thin, optional Python integration shim for HACS / external Home Assistant compatibility.

## Validation

Run `pnpm check` and `pnpm build` for full verification across all 20 workspace packages/apps, plus `pnpm lint:py && pnpm format:check:py && pnpm test:py` for Python code. Review native surfaces directly on macOS/Windows/Linux because headless browser checks cannot verify native Liquid Glass, vibrancy, acrylic, or compositor blur.
