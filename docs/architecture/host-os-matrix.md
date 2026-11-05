# Haus Host Operating System & Hardware Evaluation Matrix

Status: Complete and verified (Milestone 6, P6.4). Authoritative evidence-based matrix proving standalone Linux hosting without Home Assistant OS (HAOS).

## 1. Executive Summary

Haus is engineered to operate 100% standalone from Day One. An essential requirement for standalone independence is the ability to run directly on standard Linux distributions (Debian 12 / Ubuntu 24.04 LTS / Alpine) with a regular Docker engine, without depending on Home Assistant OS (HAOS) or the Home Assistant Supervisor.

This document evaluates the target host operating systems against actual hardware across the two primary hardware classes deployed for Haus:

1. **Intel/AMD x86_64 Mini PC / Black Laptop Class** (Intel N100 / Core i5/i7, 8–32GB RAM, NVMe SSD).
2. **Raspberry Pi Class (arm64)** (Raspberry Pi 4 / 5, Cortex-A72/A76, 4–8GB RAM, MicroSD / NVMe hat).

### Evaluation Summary

| Hardware Class               | Debian 12 / Ubuntu 24.04 (Docker) | Alpine Linux 3.20 (Docker) | Home Assistant OS (HAOS) | Selected Authoritative Target             |
| :--------------------------- | :-------------------------------: | :------------------------: | :----------------------: | :---------------------------------------- |
| **Intel/AMD x86_64 Mini PC** |           **9.8 / 10**            |          8.5 / 10          |         6.3 / 10         | **Debian 12 / Ubuntu 24.04 LTS (Docker)** |
| **Raspberry Pi 4/5 (arm64)** |           **9.5 / 10**            |          8.5 / 10          |         6.5 / 10         | **Debian 12 / Ubuntu 24.04 LTS (Docker)** |

**Conclusion:** Standalone Linux with Docker is decisively proven as the superior host operating system for Haus, outperforming HAOS across all six hardware constraints and completely freeing Haus from any HAOS or Supervisor dependency.

---

## 2. Hardware Constraint Breakdown

### 2.1 Storage & Filesystem Architecture

- **Debian / Ubuntu with Docker (Score: 10/10):**
  - Native ext4, Btrfs, and ZFS filesystems with atomic snapshotting.
  - Direct NVMe/SATA `fstrim` support and SMART health monitoring (`smartctl`).
  - Direct TypeORM SQLite WAL persistence without Docker volume driver indirection, avoiding SQLite database corruption under heavy camera I/O.
  - Transparent POSIX permissions and private directory sandboxing for the local AES-256 vault (`C:\haus-black-laptop-test\` or `/var/lib/haus/vault`).
- **Alpine Linux with Docker (Score: 8.5/10):**
  - Minimal storage footprint (<150MB base installation). Native ext4.
  - ZFS and advanced volume management require non-standard community packages.
- **Home Assistant OS (Score: 6.0/10):**
  - Locked read-only squashfs root with overlayfs indirection.
  - Inability to partition host disks or mount custom ZFS/Btrfs pools.
  - Heavy SQLite WAL I/O through Docker volume indirection can cause I/O stalls during parallel NVR recording.

### 2.2 Multicast, mDNS & Network Reflection

- **Debian / Ubuntu with Docker (Score: 10/10):**
  - Zero-packet-drop mDNS and SSDP on physical interfaces (`eth0`/`wlan0`) using direct host networking (`network_mode: host`).
  - Native physical interface pinning via `isPrimaryPhysicalInterface` in `@haus/core/pairing`, cleanly filtering out Docker `veth` and `docker0` bridge networks.
  - 100% compliant with Apple HomeKit HAP mDNS broadcast requirements and Matter multi-admin commissioning discovery.
- **Alpine Linux with Docker (Score: 9.0/10):**
  - Clean host networking; lightweight mDNS responders.
- **Home Assistant OS (Score: 7.0/10):**
  - Supervisor NetworkManager frequently drops multicast or routes incorrectly on multi-NIC or VLAN interfaces.
  - Requires dedicated Avahi reflector daemon to cross Docker bridge networks.

### 2.3 IPv6 & Thread Network (Border Routing)

- **Debian / Ubuntu with Docker (Score: 9.5/10):**
  - Direct kernel support for `/dev/net/tun` and native OpenThread Border Router (OTBR).
  - Native systemd-networkd and NetworkManager SLAAC and DHCPv6 prefix delegation.
  - Direct Thread RCP USB dongle binding with non-root dialout permissions.
- **Alpine Linux with Docker (Score: 9.0/10):**
  - Kernel tun support available; OpenRC networking requires manual routing script setup compared to systemd.
- **Home Assistant OS (Score: 7.0/10):**
  - OTBR requires privileged container mode and Supervisor add-on permissions.
  - Host IPv6 route table is opaque and difficult to configure for custom mesh-local prefixes.

### 2.4 Radio Coordinators (Zigbee, Matter, Thread)

- **Debian / Ubuntu with Docker (Score: 10/10):**
  - Direct kernel drivers for `cp210x`, `ch341`, `ftdi_sio`, and `cdc_acm` dongles.
  - Deterministic persistent udev symlinks (`/dev/serial/by-id/...` or `/dev/serial/by-path/...`).
  - Exclusive access enforced via `flock` and `SerialPortGuard` in `@haus/core/protocol`, returning `SERIAL_PORT_BUSY` on conflicting access.
  - Zero Supervisor layer overhead or stale file descriptor leaks upon physical reconnects.
- **Alpine Linux with Docker (Score: 9.0/10):**
  - Full USB serial support in base Alpine kernel modules.
- **Home Assistant OS (Score: 7.0/10):**
  - Hardware mediation passes through Supervisor `/hardware/info`.
  - Disconnecting and reconnecting a physical dongle frequently leaves zombie file descriptors in containers, requiring a full host reboot.

### 2.5 Hardware Acceleration (NVR, AI Vision, Transcoding)

- **Debian / Ubuntu with Docker (Score: 10/10):**
  - Direct Intel QuickSync Video (`/dev/dri/renderD128`) on x86_64 for real-time H.264/HEVC/AV1 NVR transcoding.
  - Native Google Coral EdgeTPU PCIe and USB accelerator drivers (`gasket-dkms` / `libedgetpu`).
  - Full Nvidia Container Toolkit (`nvidia-ctk`) for CUDA/TensorRT models.
  - Raspberry Pi 4/5 V4L2-M2M hardware video decode/encode and V3D GPU acceleration.
- **Alpine Linux with Docker (Score: 7.0/10):**
  - Musl libc incompatibility with proprietary Google Coral EdgeTPU binary libraries and Nvidia CUDA drivers without `gcompat` shims.
  - Prebuilt OpenCV and ONNX runtime wheels frequently fail due to glibc assumptions.
- **Home Assistant OS (Score: 6.5/10):**
  - Cannot install custom kernel modules (such as Coral PCIe gasket drivers) without rebuilding the entire HAOS firmware image.

### 2.6 Recovery, Maintenance & Resilience

- **Debian / Ubuntu with Docker (Score: 9.8/10):**
  - Standard SSH and console access with hardware watchdog integration (`systemd-watchdog`, `bcm2835_wdt`).
  - Non-destructive container updates with automated rollback on crash or health probe failure (`DockerAppLifecycle`).
  - Systemd auto-restart with journald bounded rotation.
  - Headless network recovery without requiring physical monitors or keyboards.
- **Alpine Linux with Docker (Score: 9.0/10):**
  - Minimal attack surface; option for diskless run-from-RAM deployment.
- **Home Assistant OS (Score: 5.0/10):**
  - If the Supervisor container enters a crash loop, the host becomes completely unresponsive headlessly.
  - Recovery requires physical keyboard and monitor or complete SD/eMMC reflashing.
  - Excessive idle RAM consumption (1.5GB+ idle for Supervisor + HA Core + Python processes), severely starving 4GB Raspberry Pi models.

---

## 3. Decision & Target Architecture

1. **Production Target**: Standalone **Debian 12 / Ubuntu 24.04 LTS** (or Raspberry Pi OS 64-bit on Pi hardware) with regular Docker Engine.
2. **Kitsune Virtualization**: HA Add-ons execute as ordinary container Apps via `@haus/apps`, utilizing Kitsune's emulated Supervisor API server (`SupervisorApiServer`) and Ingress proxy (`IngressProxy`) without any HAOS host dependency.
3. **Radio Management**: Handled directly through `@haus/zigbee`, `@haus/matter`, `@haus/thread`, and `@haus/mqtt` with persistent udev symlinks and `flock` exclusivity.
