# Haus Hub

Haus Hub is the single Haus server application. It owns the standalone home domain and composes optional storage, streaming, recording and host-monitoring roles. Home Assistant is an optional compatibility adapter; the appliance deployment is a separately selected exception. Media processes belong to `@haus/media`, host providers to `@haus/servers`, and integration compatibility to Kitsune.

The consolidation is still under acceptance. The current Nest backup/cluster services do not yet replace the complete legacy snapshot/replication workflows, and standalone authorization/appliance boundaries remain under P16 review. Local builds and packaged-process checks do not establish production release parity. Existing installations keep their image, keys and storage until a separately validated cutover.

## Source development

Use Node.js >=24.11.0 and pnpm 11.22.0 from the repository root. The dependency build includes the existing AI native target and needs a C++ toolchain; media fixtures also need FFmpeg.

```sh
pnpm install --frozen-lockfile
pnpm -r --filter @haus/hub... build
HAUS_DATA_DIR="$PWD/.local/hub" PORT=8790 pnpm --filter @haus/hub start
```

No HA URL or HA credential is required for standalone boot. The optional Matter Server adapter is inactive until `HAUS_MATTER_URL` is explicitly configured; the Hub does not guess an HA address. The current source listens on 8790 by default, on 8098 when an NVR pairing key/roles are configured, or on an explicit `PORT`. `HAUS_DATA_DIR` and the compatible `HAUS_DATA` must identify the same directory when both are set. When Hub runs in a container with the Docker socket mounted, set `HAUS_DATA_HOST_DIR` to the host-side directory backing `HAUS_DATA_DIR`; App bind mounts are resolved by the Docker daemon on that host, not inside the Hub container. The compiled health command uses that same listener configuration:

```sh
node apps/hub/dist/cli/health.js
pnpm --filter @haus/hub check
HAUS_NVR_TEST_DISPOSABLE=0 pnpm --filter @haus/hub test:integration
```

Use the same configuration environment for the health command as the running process. Integration tests use synthetic loopback servers/media; a remote write test requires a separately provisioned disposable origin and explicit opt-in.

## Images and deployment assets

One Dockerfile builds the full application and both native engines. Its default `hub` target runs unprivileged and keeps the NVR image aliases; the explicit `addon` target preserves the HA appliance image aliases and port 8099. Image names, release tags and `haus-helper` add-on slug remain compatibility identities.

```sh
docker build --target hub --file apps/hub/Dockerfile --tag haus-hub:local .
```

Actual Linux image acceptance is pending; the local Docker daemon was unavailable during this source migration. Builds never update an installed service or pull a new image into a household deployment.

- [Upgrade and path mapping](docs/upgrade.md) covers existing Compose project/volume identity and explicit image selection.
- [Storage/media roles and recovery](docs/nvr.md), [server telemetry](docs/servers.md) and [archive verification](docs/verification.md) retain the protocol/deployment contracts.
- [HA appliance compatibility](docs/appliance.md) and [appliance app documentation](DOCS.md) describe the explicit legacy HA deployment, whose behavior still needs parity review before source cutover.
- [Media](../../packages/media/README.md), [AI model installation](../../packages/ai/README.md) and [optional memory probe](../../packages/servers/README.md) document their owning packages.

Haus code is GPL-3.0-or-later; see [LICENSE](../../LICENSE) and [third-party notices](../../THIRD_PARTY_NOTICES/README.md).
