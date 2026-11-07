# Hub deployment asset ownership — 2026-11-07

P14.2.3.3.3.2 re-homes the five Node Compose profiles, host-collector unit and operational documentation under Hub. It does not operate an installed stack or change the default image pin.

## Contracts preserved

- `apps/hub/deploy` owns storage/streaming Compose, host telemetry and optional mDNS. Its `monitoring` category owns the empty-role profile and matching telemetry override. The example systemd unit retains its installed name, account, paths, report permissions and sandbox; its bytes match the previous tracked file.
- Service names, named-volume keys, pairing-key/node-ID variables, quota/origin policy, port 8098, UDP ranges, read-only root, tmpfs, dropped capabilities and shutdown grace are unchanged. `HAUS_IMAGE` permits explicit local/release selection; the unset default stays `ghcr.io/resonaura/haus/nvr:0.3.47`. No release/version bump or registry write occurred.
- Moving Compose directories changes their inferred project name. The upgrade guide requires the existing --project-name/COMPOSE_PROJECT_NAME and exact bind/volume/key identity; otherwise a second stack/empty volume could be created. It provides config-only inspection examples and makes actual cutover/rollback verification separate. No identity file or archive is renamed.
- Hub README is standalone-first and no longer requires HA credentials for core development. Appliance-specific guidance is grouped in `docs/appliance.md`; the installed addon DOCS entrypoint remains and is explicitly scoped to that legacy mode. The docs disclose incomplete Nest backup/cluster/security parity and pending Linux image acceptance instead of implying a released upgrade.
- NVR, telemetry and archive-verification docs belong to `apps/hub/docs`. Old dependency-free/individual-MJS collector instructions are replaced with the compiled Hub CLI and complete dependency tree. Local links resolve. Root architecture/development entrypoints point to the shared Hub recipe. The NVR release history and icon are retained byte-identically in `docs/history/releases/nvr.md` and Hub assets.

## Observed checks

- PASS — standalone Docker Compose 2.37.1, config-only, no daemon: five old/new profile combinations serialize to exactly equal normalized JSON with an explicit preserved project name and an owned empty env file. Cases cover storage, storage+telemetry, storage+mDNS, monitoring and monitoring+telemetry. Every volume keeps its preserved-home prefix; both profiles remain read-only with cap_drop ALL.
- PASS — both profiles select an explicitly supplied synthetic HAUS_IMAGE while their unset defaults remain identical to the previous definitions. No image is pulled and no container/volume is created by config inspection.
- PASS — exact comparisons against tracked originals for the systemd unit, NVR release history and icon.
- PASS — all local Markdown/image links in the current Hub/role docs and NVR development guide resolve; engineering/license rules, explicit formatting of normally ignored Hub assets/docs/workflow YAML and final diff whitespace pass.

## Limits and continuation

Real image startup, installation, service management, persistent-volume upgrade and archive recovery on existing household data are NOT RUN. Docker's local daemon remains unavailable, so P14.2.3.3.3.1 stays in progress. The standalone compose client validates configuration independently. Next, remove the unused Node package/recipe and update workspace/check/lockfile consumers, then run the full gate. Root agent rules are preserved.
