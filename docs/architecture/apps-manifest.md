# Haus Apps Manifest and Permission Contract

## 1. Overview

Haus Apps are self-contained, managed containerized workloads (such as Zigbee2MQTT, Scrypted, Mosquitto, or custom integrations) that run on a Haus Hub or Node.

To provide security without relying on broad container privileges or arbitrary host daemons, Haus implements an explicit, validated manifest format and a strict deny-by-default permission policy matrix.

## 2. Manifest Schema (`packages/apps/src/manifest.ts`)

Every Haus App declares its operational requirements in an `AppManifest`:

```typescript
export interface AppManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly image: string;
  readonly description?: string;
  readonly architectures: readonly AppArchitecture[];
  readonly health?: AppHealthCheck;
  readonly options?: readonly AppOptionSchema[];
  readonly secrets?: readonly AppSecretDeclaration[];
  readonly ports?: readonly AppPortMapping[];
  readonly mounts?: readonly AppMount[];
  readonly devices?: readonly AppDevice[];
  readonly network?: AppNetwork;
  readonly resources?: AppResources;
  readonly ingress?: AppIngress;
  readonly lifecycle?: AppLifecycle;
}
```

### Core Components

- **Identity & Image:** Unique slug `id` (e.g. `zigbee2mqtt`), human `name`, semantic `version`, and container `image` repository.
- **Architectures:** Explicitly targeted CPU architectures (`amd64`, `arm64`, `armv7`, `i386`).
- **Health Checks:** Probing intervals, timeouts, retries, and optional HTTP endpoint or command.
- **Options vs. Secrets:** Configuration parameters (`options`) are explicitly separated from sensitive credentials (`secrets`). Secrets are never logged or exposed across renderer RPCs.
- **Mounts:** Restricted to approved logical namespaces (`data`, `media`, `share`, `backup`, `config`).
- **Devices:** Specific hardware access (`gpu`, `video`, `serial`, `usb`).
- **Network & Ports:** Network modes (`bridge`, `host`, `internal`, `none`) and port mappings.
- **Ingress:** Web UI integration through authenticated reverse proxy.
- **Lifecycle:** Restart policy (`unless-stopped`, `on-failure`, `always`, `no`) and graceful stop timeouts.

## 3. Permission Contract & Policy Matrix (`packages/apps/src/policy.ts`)

### 3.1 Deny by Default

An app starts with baseline sandboxed capabilities: private isolated `data` mount and standard bridge network. Any capability beyond this requires an explicit granted permission:

| Capability / Requirement | Permission Required | Security Impact                                  |
| :----------------------- | :------------------ | :----------------------------------------------- |
| `mount:media`            | `mount:media`       | Access to household NVR video recordings         |
| `mount:share`            | `mount:share`       | Shared file storage access                       |
| `mount:backup`           | `mount:backup`      | Access to snapshot archives                      |
| `mount:config`           | `mount:config`      | Access to shared hub configurations              |
| `network:host`           | `network:host`      | Host network namespace (bypasses port isolation) |
| `device:gpu`             | `device:gpu`        | Direct rendering hardware acceleration           |
| `device:video`           | `device:video`      | Video capture devices (e.g. `/dev/video*`)       |
| `device:serial`          | `device:serial`     | Serial adapters (Zigbee/Z-Wave dongles)          |
| `device:usb`             | `device:usb`        | Direct USB devices (e.g. Coral TPU)              |
| `ingress`                | `ingress`           | Web UI reverse-proxy routing                     |
| `port:privileged`        | `port:privileged`   | Binding host ports < 1024                        |

### 3.2 Invariant Security Rules

- **No Docker Socket Grant:** Mounting `/var/run/docker.sock` is unconditionally forbidden and results in a critical policy violation. Apps cannot control the container daemon.
- **No Arbitrary Host Mounts:** Paths such as `/`, `/etc`, `/proc`, `/sys`, `/root`, or any path traversal (`..`) are forbidden.
- **Least Privilege:** Missing permissions cause immediate rejection (`allowed: false`) before container provisioning.
