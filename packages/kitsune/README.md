<!-- SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. -->

# Kitsune

`@haus/kitsune` is Haus's camera integration boundary. Native Aqara/Tuya bridge metadata, Eufy discovery/talkback, source protection, exact registry roles and validated vendor playback profiles live here. The Tuya source-facing C++ adapter is in `src/vendors/native/tuya/cpp`; NVR keeps its generic browser WebRTC, RTP continuity, IPC and media scheduling. Existing native bridge enrollment and recording IDs are preserved.

All Kitsune source is GPL-3.0-only. Other Haus packages retain their existing licenses. This is an independently authored interoperability implementation, not Scrypted server code, a Scrypted distribution or a guarantee that every upstream plugin works.

## Boundaries

- `src/sdk/v1`: independently specified names, enums and supported surface. `sdk/managers.ts` implements the managers and reactive device base; `sdk/proxy-guard.ts` handles newer optional calls.
- `src/runtime`: registry resolution, SHA-512 verification, bounded link-free archive extraction, private runtime installation, subprocess lifecycle and webhooks.
- `src/vendors/native`: extracted Haus drivers and exact vendor identity/transport rules.
- `src/vendors/catalog`: browser-safe onboarding metadata. `vendors/overrides.ts` chooses native versus npm drivers and maps only actual plugin-provided setting keys.
- `src/haus.ts`: device discovery, stable camera identities, motion events and validated RTSP sources for the existing Haus/NVR pipelines. No plugin FFmpeg argument is executed by the controller.

No Scrypted SDK or server package is a dependency. `require('@scrypted/sdk')` is intercepted **inside each dedicated child process**. Packaged plugins that use ambient SDK managers receive the same independently implemented objects. Third-party plugin files remain opaque runtime artifacts outside this repository; their own bundled build products and licenses remain their responsibility and are not relicensed as Kitsune source.

## Runtime installation and lifecycle

```ts
import { Kitsune } from '@haus/kitsune';

const hub = new Kitsune({
  dataDirectory: '/data',
  endpointBase: 'http://192.168.1.10:8099/api/kitsune/hooks',
  ffmpegPath: 'ffmpeg',
  memoryMb: 192,
  maxPlugins: 2,
  emit: (event) => discovery.accept(event),
  diagnostic: (event) => diagnostics.write(event),
});

// Explicit opt-in; constructing the hub performs no network installation.
await hub.enable('rtsp');
// Or explicitly bootstrap the RTSP and ONVIF base providers:
// await hub.bootstrapBasePlugins();
await hub.stop();
```

Artifacts are installed atomically under `<data>/kitsune/plugins/<identity>`. No lifecycle scripts run. The installer ignores the intercepted SDK dependency and packaged development `file:` dependencies, rejects server dependencies, verifies registry tarball integrity and rejects links/traversal. Only `registry.npmjs.org` HTTPS artifacts are accepted. External registry dependencies have bounded recursion/count/download sizes. A plugin that needs an unsupported native install hook, local-only dependency or another server service fails explicitly; the installer does not execute a shell to make it work.

Persist the resolved version after the first explicit enable. Exact-version restarts reuse a completed local receipt without contacting npm. Helper stores this pin in its database; a restart does not silently upgrade to a new upstream release. Plugin storage is scoped by plugin and native device identity, written atomically with private permissions, and survives runtime restarts. A host may inject its existing storage backend when using `createSdk` directly. Include `kitsune/state` and `kitsune/hooks` in host filesystem backups; plugin artifacts can be downloaded again.

Each runtime is a separate Node process with a configurable V8 memory limit, minimal environment, bounded call/startup deadlines and termination. This isolates module hooks, crashes and lifecycle; **it is not a security sandbox for hostile npm code**. Runtime plugins are administrator-selected trusted code. Deploy untrusted integrations under an OS/container security boundary. The default hub admits at most two plugin processes; increasing that limit is explicit.

## Controller API and HA/NVR integration

Helper exposes administrator-only catalog and opt-in setup endpoints:

- `GET /api/kitsune/catalog`
- `POST /api/kitsune/<vendor>/enable` with `{}`
- `POST /api/kitsune/<vendor>/settings` with `{}` for the actual plugin creation schema
- `POST /api/kitsune/<vendor>/onboard` with `{ "fields": { ... } }` maps essential fields against the actual creation schema; ambiguous or unsupported mappings stop before creating a device.
- `POST /api/kitsune/<vendor>/create` with `{ "settings": { ... } }`

These are backend building blocks, not a completed new onboarding screen. Existing Add Camera integration hints consume the shared catalog. Presets provide essential fields; if an upstream schema changes or a mapping is ambiguous, `onboardingSettings` requires review instead of writing guessed storage keys. Cloud OAuth/2FA must use the plugin's real supported flow; a catalog entry is not evidence that a cloud provider has passed physical acceptance.

Discovered video cameras use stable `camera.kitsune_*` IDs, enter Helper discovery and use the existing HA camera/Activity presentation and NVR recording pipeline. New cameras default to stream-only. Recorded-camera settings and identities of existing bridges are untouched. Primary recording/preview selection uses measured resolution and bitrate, with display-name hints only as a tiebreaker. The host validates/pins the extracted source URL before an NVR can use it. Arbitrary plugin FFmpeg arguments never become controller shell commands.

Webhook endpoints use persistent per-plugin capability tokens and route only to a running plugin's `onRequest`. The Helper router bounds the request body and forwards the request/response through IPC. Tokens are never shared diagnostics. Set `HAUS_KITSUNE_ENDPOINT` to the Helper's camera-reachable LAN hook base when push events are required; its default loopback base is suitable only for local callers. Set `HAUS_KITSUNE_PUBLIC_ENDPOINT` only when an explicitly managed public TLS callback route exists. Kitsune does not invent a public endpoint or bypass router authentication.

Unknown SDK calls return bounded, chainable, awaitable fallbacks and emit name-only `kitsune:compat` warnings. They do not expose argument values. Known unsupported media conversions and missing physical device methods fail explicitly; no frames, device capabilities or successful commands are fabricated. The API surface is versioned so a future method can be implemented without replacing the host/NVR interface.

## Compatibility and verification

The simulated unmodified CommonJS/plugin.zip lifecycle is covered by tests: runtime-only installation, SDK interception, persistent credentials, device discovery/state, source extraction, stream choice, webhook handling, explicit missing-command rejection and restart. Existing Helper tests cover the extracted native adapters. A separate bounded acceptance run starts published `@scrypted/rtsp` **0.0.55** and reads its creation schema without installing an SDK package or contacting household cameras. This does not establish physical camera or all-vendor compatibility.

ONVIF, Reolink, Hikvision, Amcrest/Dahua, UniFi Protect, Tapo and Ring are catalog routes, not a claim of completed vendor acceptance. In the checked npm metadata `@scrypted/dahua` and `@resonaura/scrypted-tuya` do not exist: Dahua routes to Amcrest, Tuya defaults to the existing native bridge. A verified fork can be selected through explicit overrides later. Optional upstream prebuffer/snapshot plugin dependencies are recorded in receipts; Haus's own media pipeline supplies those functions rather than automatically installing unrelated services.

```sh
pnpm --filter @haus/kitsune test
pnpm --filter @haus/kitsune check:sdk
```

The compatibility checker downloads public SDK declarations into memory, parses exported symbols/methods/enums, and prints missing surface names. It never installs or executes the SDK. Its checklist includes type-only exports, which may need no runtime implementation. Updating a checklist is not a runtime compatibility test.

Public interoperability references: [Scrypted plugin development](https://developer.scrypted.app/plugins.html), [camera plugin selection](https://docs.scrypted.app/add-camera.html), [npm RTSP metadata](https://registry.npmjs.org/%40scrypted%2Frtsp/latest), [npm public SDK metadata](https://registry.npmjs.org/%40scrypted%2Fsdk/latest). The extraction inventory is in [the repository audit](../../docs/architecture/kitsune-audit.md).
