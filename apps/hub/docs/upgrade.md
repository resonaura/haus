# Hub deployment paths and compatibility

The source runtime is now `apps/hub/dist/main.js`. Storage, streaming and monitoring are roles of this full Hub application. The old NVR/HA image names remain deployment aliases; moving a source file does not upgrade an installed image or authorize changing a running home.

## Asset mapping

| Previous path under `apps/node`                                          | Owner under `apps/hub`                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `Dockerfile`                                                             | `Dockerfile`, target `hub`; target `addon` preserves the HA appliance alias |
| `compose.yaml`                                                           | `deploy/compose.yaml`                                                       |
| `compose.host-telemetry.yaml`                                            | `deploy/telemetry.yaml`                                                     |
| `compose.mdns.yaml`                                                      | `deploy/mdns.yaml`                                                          |
| `compose.monitoring.yaml`                                                | `deploy/monitoring/compose.yaml`                                            |
| `compose.monitoring.host-telemetry.yaml`                                 | `deploy/monitoring/telemetry.yaml`                                          |
| `deploy/haus-host-telemetry.service`                                     | `deploy/haus-host-telemetry.service`                                        |
| `README.md`, `docs/server-management.md`, `docs/archive-verification.md` | `docs/nvr.md`, `docs/servers.md`, `docs/verification.md`                    |

NVR release history is preserved in [the release archive](../../../docs/history/releases/nvr.md). Model/probe tools are owned by `@haus/ai` and `@haus/servers`; their READMEs document the replacement built commands.

## Preserve the existing stack

Compose derives a project name from its directory unless explicitly set. A checkout path changes from `apps/node` to `apps/hub/deploy`, and the monitoring profile moves into its own directory. Always pass the **existing** project name with `--project-name` when using these moved files. Keep an existing `COMPOSE_PROJECT_NAME` or established operator override unchanged. Copying a profile into a new directory and accepting a new default project can create a second stack and a new empty volume.

The moved profiles preserve service names `haus-nvr` and `haus-helper`, volume keys `haus-nvr` and `haus-monitoring`, `/data` mounts, pairing-key environment names, HTTP port 8098, media UDP ranges and monitoring-only roles. With the same project name, Compose retains the same generated volume/container identities. An explicitly assigned volume name or bind mount must also be retained exactly. Do not run old and new stacks against one data directory or create a second physical-action owner.

For a future authorized cutover, inspect the selected configuration first. Replace these placeholders with the existing project and private environment file; `config` validates without starting containers:

```sh
docker compose --project-name EXISTING_PROJECT --env-file /private/server.env \
  --file apps/hub/deploy/compose.yaml config --quiet
docker compose --project-name EXISTING_PROJECT --env-file /private/server.env \
  --file apps/hub/deploy/monitoring/compose.yaml \
  --file apps/hub/deploy/monitoring/telemetry.yaml config --quiet
```

Use the existing profile's exact volume/bind/key/role/port policy when reviewing differences. Do not regenerate pairing keys or node IDs, reset instance/catalog files, rename SQL data, import archives, or delete the old volume as part of a path update. Keeping existing identities and original bytes is required for rollback; startup and archive compatibility need validation before using a new artifact on that data.

## Select an image explicitly

`HAUS_IMAGE` can select a reviewed local or release image. When unset, the Compose files retain their prior `ghcr.io/resonaura/haus/nvr:0.3.47` default. That unchanged pin does not imply that it contains the new source. No version is bumped or image published by this migration.

Both aliases now build from `apps/hub/Dockerfile`: NVR tags use target `hub`, HA helper tags use target `addon`. Standalone boot defaults to port 8790; providing an NVR key selects 8098; the addon target explicitly sets 8099. Both targets use the same compiled main and configuration-driven health CLI. Linux image validation, legacy-domain parity and standalone security review remain release gates.

The native host collector keeps its systemd service name and output path. Build/install its complete Hub dependency tree; copying old individual MJS files is no longer an update path. Its example unit runs the compiled telemetry CLI and does not grant the Hub container a Docker socket or host-management capabilities.
