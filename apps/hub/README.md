# Haus Hub

Haus Hub (`@haus/hub`) is the single standalone NestJS server application for Haus. It owns the local home domain, TypeORM/SQLite persistence, native MQTT broker (with HA-compatible discovery and 7-day reboot/stale grace retention), Matter/Zigbee/Thread radio orchestration, Apple Home / HomeKit Secure Video (`@haus/homekit`), Kitsune plugin & integration virtualization (`@haus/kitsune`), managed Docker Apps (`@haus/apps`), and optional NVR storage, streaming, recording, AI activity detection (`@haus/ai`), and host-monitoring (`@haus/servers`) roles.

Home Assistant is strictly an optional external compatibility adapter (`@haus/ha`); the legacy HA appliance container target remains available as an explicit opt-in build target. Media process execution belongs to `@haus/media`, host probes to `@haus/servers`, and icon rendering to `@haus/icons`.

## Source development

Use Node.js `>=24.11.0` and `pnpm@11.22.0` from the repository root. The workspace dependency build compiles the C++20 icon worker (`@haus/icons`) and AI native target (`@haus/ai`) and requires a C++20 toolchain; media/HomeKit fixtures require FFmpeg.

```sh
pnpm install --frozen-lockfile
pnpm -r --filter @haus/hub... build
HAUS_DATA_DIR="$PWD/.local/hub" PORT=8790 pnpm --filter @haus/hub start
```

No Home Assistant URL or credential is required for standalone boot. The optional Matter Server adapter remains inactive until `HAUS_MATTER_URL` is explicitly configured; the Hub never guesses an external address. The server listens on `8790` by default, on `8098` when NVR pairing keys/roles are configured, or on an explicit `PORT`. `HAUS_DATA_DIR` and the compatible `HAUS_DATA` alias must resolve to the same directory when both are set. When running in a container with the Docker socket mounted, set `HAUS_DATA_HOST_DIR` to the host-side directory backing `HAUS_DATA_DIR`.

Health and verification commands:

```sh
node apps/hub/dist/cli/health.js
pnpm --filter @haus/hub check
HAUS_NVR_TEST_DISPOSABLE=0 pnpm --filter @haus/hub test:integration
```

Integration tests run against synthetic loopback servers and media fixtures; remote write tests require a separately provisioned disposable target and explicit opt-in.

## Standalone installation (Linux, Docker & Windows WSL2)

- **Linux & WSL2 automated setup:** `sudo bash apps/hub/install/hub.sh --mode native --data-dir /var/lib/haus` (or `--mode docker`).
- **Windows host helper for WSL2:** `.\apps\hub\install\wsl-windows.ps1 -Action SetupMirrored -RegisterStartupTask` (recommended on Windows 11 22H2+) or `-Action SetupNat` in Elevated PowerShell.
- **WSL2 preflight check:** `pnpm --filter @haus/hub wsl --check` inspects `networkingMode`, `systemd`, `/mnt/<drive>` data paths, and Windows LAN reachability.
- **Standalone Compose stack:** [`deploy/hub/compose.yaml`](deploy/hub/compose.yaml) (plus [`deploy/hub/wsl-mirrored.yaml`](deploy/hub/wsl-mirrored.yaml) for host-networked Linux or native Docker Engine in WSL2 mirrored mode).
- **Multi-hub deployment:** `pnpm deploy:hubs` builds and deploys configured Hub hosts (see [`scripts/deploy-hubs.example.json`](../../scripts/deploy-hubs.example.json)).

See the [Linux, Docker & WSL2 installation guide](docs/install.md) for SQLite `ext4` storage rules, Task Scheduler keepalive setup, NAT `lan-relay` / `advertise` fallbacks, and USB `usbipd-win` radio passthrough.

## Images and deployment assets

A single [Dockerfile](Dockerfile) builds the full application and its native C++ engines. Its default `hub` target runs unprivileged and retains NVR image aliases; the explicit `addon` target preserves legacy HA appliance image aliases and port `8099`.

```sh
docker build --target hub --file apps/hub/Dockerfile --tag haus-hub:local .
```

When running the Hub container on Linux with Bluetooth integrations or Homebridge BLE plugins (such as `govee` / `homebridge-govee` or Xiaomi BLE), grant `NET_RAW` (`--cap-add=NET_RAW`), use host networking (`--network=host`), and mount the BlueZ D-Bus socket (`-v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket`). Bare-metal `systemd` services use `AmbientCapabilities=CAP_NET_RAW`.

## Related Hub documentation

- [Linux, Docker & WSL2 installation](docs/install.md) — native `systemd`, Docker Compose, and WSL2 networking.
- [Upgrade and path mapping](docs/upgrade.md) — Compose project/volume identity preservation and image selection.
- [Storage, media roles & recovery](docs/nvr.md) — NVR pairing, encrypted replication, and live relays.
- [Server telemetry](docs/servers.md) and [archive verification](docs/verification.md) — host metrics and backup integrity checks.
- [HomeKit & HKSV](HOMEKIT.md) — Apple Home bridge/camera publishing and SRTP media leases.
- [HA appliance compatibility](docs/appliance.md) and [appliance reference](DOCS.md) — explicit legacy HA deployment documentation.
- Owning packages: [`@haus/media`](../../packages/media/README.md), [`@haus/ai`](../../packages/ai/README.md), [`@haus/kitsune`](../../packages/kitsune/README.md), [`@haus/homekit`](../../packages/homekit/README.md), and [`@haus/servers`](../../packages/servers/README.md).

Haus code is GPL-3.0-or-later; see [LICENSE](../../LICENSE) and [third-party notices](../../THIRD_PARTY_NOTICES/README.md).
