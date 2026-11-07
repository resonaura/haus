# Haus servers

`@haus/servers` owns host telemetry, bounded hardware inventory and node clients. Ordinary collectors run without privileges and report unavailable hardware facts as unknown.

## Optional installed-memory probe

When Linux restricts SMBIOS records to root, the optional probe exports only version, installed byte capacity, boot UUID and sample time. It reuses the collector's DMI parser, bounds each record to 4096 bytes and the inventory to 128 devices, and rejects truncated/partial inventories. Raw firmware and module identifiers never enter its report. The existing collector accepts only a fresh report from the current boot.

From the repository root, build with `pnpm --filter @haus/servers build`. Explicit installation is `sudo sh packages/servers/install/memory.sh`; this replaces `apps/node/install/host-memory-probe.sh`. Installation copies the compiled CLI and its three local dependencies, an ESM package marker and a root-owned Node executable into `/usr/local/lib/haus-host-memory`. Re-running the installer updates the existing `haus-host-memory.service` and `.timer` definitions; their names, one-minute interval and `/var/lib/haus-host-telemetry/installed-memory.json` report path/schema remain compatible. The service entrypoint changes from `host-memory-probe.mjs` to `probe/cli.js`.

The service retains its read-only filesystem sandbox, empty capability set and network prohibition. A verified sample replaces the report atomically; missing firmware, malformed data or an invalid boot identity preserve its previous contents, which naturally expire at the collector. `pnpm --filter @haus/servers probe --output /absolute/hardware.json` invokes the same built CLI explicitly; it is never launched by tests/builds or ordinary service startup.

Tests inject synthetic firmware and write only disposable directories. Installer syntax and isolated compiled entrypoint resolution can be checked without installing anything. Actual privileged probing, systemd installation and host service execution are separate operational actions and are not implied by code verification.
