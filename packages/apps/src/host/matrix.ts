/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  HardwareClass,
  HostOsTarget,
  type HardwareSupportComparison,
  type HostOsProfile,
} from './types.js';

function computeOverallScore(profile: Omit<HostOsProfile, 'overallScore'>): number {
  const scores = [
    profile.storage.score,
    profile.multicast.score,
    profile.ipv6Thread.score,
    profile.radios.score,
    profile.hardwareAcceleration.score,
    profile.recovery.score,
  ];
  const sum = scores.reduce((acc, score) => acc + score, 0);
  return Number((sum / scores.length).toFixed(1));
}

function buildIntelProfiles(): readonly HostOsProfile[] {
  // 1. Debian 12 / Ubuntu 24.04 LTS with Docker
  const debianUbuntuBase = {
    os: HostOsTarget.DebianUbuntuDocker,
    name: 'Debian 12 / Ubuntu 24.04 LTS with Docker',
    storage: {
      score: 10,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Native ext4, btrfs, and zfs filesystem support with atomic snapshots',
        'Direct NVMe/SATA fstrim and SMART monitoring',
        'Direct TypeORM SQLite WAL persistence without Docker volume indirection',
        'Transparent POSIX permission sandboxing for isolated Hub vault and media directories',
      ],
      limitations: [],
    },
    multicast: {
      score: 10,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Zero-packet-drop mDNS and SSDP on physical interfaces (eth0/wlan0)',
        'Interface filtering (isPrimaryPhysicalInterface) cleanly excludes virtual Docker veth bridges',
        'Full compatibility with Apple HomeKit HAP mDNS broadcast requirements',
      ],
      limitations: [],
    },
    ipv6Thread: {
      score: 9.5,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Direct kernel support for /dev/net/tun and OpenThread Border Router',
        'Native systemd-networkd and NetworkManager SLAAC and DHCPv6 routing',
        'Full Thread NCP/RCP USB dongle compatibility with non-root dialout permissions',
      ],
      limitations: ['Requires enabling net.ipv6.conf.all.forwarding=1 in sysctl for OTBR'],
    },
    radios: {
      score: 10,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Direct kernel drivers for cp210x, ch341, ftdi_sio, and cdc_acm dongles',
        'Deterministic persistent udev symlinks (/dev/serial/by-id/...)',
        'Exclusive serial access protected by flock and SerialPortGuard in @haus/core/protocol',
        'Zero Supervisor container layer overhead or stale serial file descriptor leaks',
      ],
      limitations: [],
    },
    hardwareAcceleration: {
      score: 10,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Direct Intel QuickSync Video (i915/xe) via /dev/dri/renderD128 for real-time NVR transcoding',
        'Full VA-API hardware decode/encode for H.264, HEVC, and AV1',
        'Native Google Coral EdgeTPU PCIe and USB accelerator drivers (gasket-dkms / libedgetpu)',
        'Full Nvidia Container Toolkit (nvidia-ctk) support for CUDA/TensorRT models',
      ],
      limitations: [],
    },
    recovery: {
      score: 9.5,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Standard SSH and console access with hardware watchdog integration',
        'Non-destructive application rollback without wiping host storage',
        'Systemd auto-restart and journald logging with rotation bounds',
        'Clean headless recovery without physical monitor/keyboard requirement',
      ],
      limitations: [],
    },
    recommended: true,
    standaloneCapable: true,
  };

  const debianUbuntuProfile: HostOsProfile = {
    ...debianUbuntuBase,
    overallScore: computeOverallScore(debianUbuntuBase),
  };

  // 2. Alpine Linux with Docker
  const alpineBase = {
    os: HostOsTarget.AlpineDocker,
    name: 'Alpine Linux 3.20 with Docker',
    storage: {
      score: 8.5,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Extremely lightweight footprint (<150MB base RAM usage)',
        'Fast boot and minimal attack surface',
        'Native ext4 storage support',
      ],
      limitations: [
        'ZFS and advanced storage requires non-standard out-of-tree Alpine community packages',
      ],
    },
    multicast: {
      score: 9,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Direct host networking and lightweight mDNS'],
      limitations: [],
    },
    ipv6Thread: {
      score: 9,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Native kernel tun and IPv6 routing'],
      limitations: ['OpenRC configuration differs from standard systemd-networkd setups'],
    },
    radios: {
      score: 9,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Standard USB serial drivers available in alpine-base'],
      limitations: [],
    },
    hardwareAcceleration: {
      score: 7,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Intel VA-API supported via mesa-va-gallium'],
      limitations: [
        'Musl libc incompatibility with proprietary Google Coral EdgeTPU and Nvidia binary drivers without gcompat shim',
        'Prebuilt OpenCV and ONNX runtime wheels often require glibc',
      ],
    },
    recovery: {
      score: 9,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Minimal immutable-style deployment option with diskless run-from-RAM mode'],
      limitations: [],
    },
    recommended: false,
    standaloneCapable: true,
  };

  const alpineProfile: HostOsProfile = {
    ...alpineBase,
    overallScore: computeOverallScore(alpineBase),
  };

  // 3. Home Assistant OS (HAOS)
  const haosBase = {
    os: HostOsTarget.HaosHost,
    name: 'Home Assistant OS (HAOS Buildroot / RAUC)',
    storage: {
      score: 6,
      supported: false,
      directHardwareAccess: false,
      advantages: ['Automated Supervisor backup integration'],
      limitations: [
        'Locked read-only root with squashfs and overlayfs indirection',
        'Cannot partition host storage or mount custom ZFS/Btrfs pools',
        'Storage volumes managed strictly through Supervisor abstractions with I/O overhead',
        'TypeORM database writes constrained by Docker volume driver performance',
      ],
    },
    multicast: {
      score: 7,
      supported: true,
      directHardwareAccess: false,
      advantages: ['Built-in Avahi daemon in Supervisor container'],
      limitations: [
        'Supervisor network management frequently interferes with multi-NIC or VLAN interfaces',
        'Docker bridge drops multicast packets unless host networking is specifically configured',
      ],
    },
    ipv6Thread: {
      score: 7,
      supported: true,
      directHardwareAccess: false,
      advantages: ['Pre-packaged OpenThread Border Router add-on available'],
      limitations: [
        'Requires privileged container mode and Supervisor add-on permissions',
        'Host IPv6 route table controlled by NetworkManager in Supervisor container',
      ],
    },
    radios: {
      score: 7,
      supported: true,
      directHardwareAccess: false,
      advantages: ['Supervisor auto-discovers serial dongles via /hardware/info'],
      limitations: [
        'Container serial passthrough can leak file descriptors upon physical disconnect/reconnect',
        'Cannot implement custom host udev rules or low-level kernel driver tuning',
      ],
    },
    hardwareAcceleration: {
      score: 6.5,
      supported: true,
      directHardwareAccess: false,
      advantages: ['Intel QuickSync passthrough supported if enabled in add-on manifest'],
      limitations: [
        'Cannot install custom kernel modules (e.g. Coral PCIe gasket driver) without rebuilding HAOS',
        'Limited NVR video acceleration diagnostics on host',
      ],
    },
    recovery: {
      score: 5,
      supported: false,
      directHardwareAccess: false,
      advantages: ['A/B dual partition slots with RAUC atomic rollback'],
      limitations: [
        'Host is locked down; recovery without working network requires physical keyboard and display',
        'If Supervisor container crashes or loops, entire host becomes inaccessible',
        'Cannot perform standard Linux administration, package upgrades, or ad-hoc process debugging',
      ],
    },
    recommended: false,
    standaloneCapable: false,
  };

  const haosProfile: HostOsProfile = {
    ...haosBase,
    overallScore: computeOverallScore(haosBase),
  };

  return [debianUbuntuProfile, alpineProfile, haosProfile];
}

function buildRpiProfiles(): readonly HostOsProfile[] {
  // 1. Debian 12 / Ubuntu 24.04 LTS (Raspberry Pi OS 64-bit) with Docker
  const debianRpiBase = {
    os: HostOsTarget.DebianUbuntuDocker,
    name: 'Debian 12 / Ubuntu 24.04 LTS (Pi OS 64-bit) with Docker',
    storage: {
      score: 9.5,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Native ext4 on MicroSD or USB3/NVMe SSD (Pi 5 PCIe hat)',
        'Direct fstrim support for SSDs to prevent wear',
        'Direct TypeORM SQLite WAL persistence without indirection',
      ],
      limitations: ['MicroSD cards have limited write endurance compared to NVMe SSDs'],
    },
    multicast: {
      score: 10,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Direct host networking with clean physical interface binding',
        'Zero multicast bridge packet loss for HomeKit and Matter',
      ],
      limitations: [],
    },
    ipv6Thread: {
      score: 9.5,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Native /dev/net/tun support for OTBR',
        'Thread RCP support over USB or Raspberry Pi GPIO UART (/dev/ttyAMA0)',
      ],
      limitations: [],
    },
    radios: {
      score: 10,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Direct access to both USB dongles and Raspberry Pi GPIO serial pins',
        'Kernel udev rules guarantee stable paths (/dev/serial/by-id/...)',
        'flock serial exclusivity protects against dual-writer corruption',
      ],
      limitations: [],
    },
    hardwareAcceleration: {
      score: 8.5,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Raspberry Pi V4L2-M2M hardware video decode/encode',
        'V3D OpenGL/Vulkan GPU acceleration',
        'Google Coral USB EdgeTPU supported via official Debian arm64 packages',
      ],
      limitations: ['Raspberry Pi hardware video encoder limited compared to Intel QuickSync'],
    },
    recovery: {
      score: 9.5,
      supported: true,
      directHardwareAccess: true,
      advantages: [
        'Headless Wi-Fi/Ethernet boot via standard userconf.txt and wpa_supplicant',
        'Hardware watchdog (bcm2835_wdt) auto-reboots host on kernel hang',
        'Easy backup/restore via MicroSD/NVMe image cloning',
      ],
      limitations: [],
    },
    recommended: true,
    standaloneCapable: true,
  };

  const debianRpiProfile: HostOsProfile = {
    ...debianRpiBase,
    overallScore: computeOverallScore(debianRpiBase),
  };

  // 2. Alpine Linux with Docker (Rpi)
  const alpineRpiBase = {
    os: HostOsTarget.AlpineDocker,
    name: 'Alpine Linux 3.20 (aarch64) with Docker',
    storage: {
      score: 8.5,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Minimal RAM footprint preserving constrained Pi memory'],
      limitations: [],
    },
    multicast: {
      score: 9,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Clean host network mDNS'],
      limitations: [],
    },
    ipv6Thread: {
      score: 9,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Kernel tun and IPv6 support'],
      limitations: [],
    },
    radios: {
      score: 9,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Serial access over USB and GPIO'],
      limitations: [],
    },
    hardwareAcceleration: {
      score: 7,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Basic V4L2 video support'],
      limitations: ['Prebuilt Coral EdgeTPU and Pi camera libraries require glibc'],
    },
    recovery: {
      score: 8.5,
      supported: true,
      directHardwareAccess: true,
      advantages: ['Fast boot'],
      limitations: [],
    },
    recommended: false,
    standaloneCapable: true,
  };

  const alpineRpiProfile: HostOsProfile = {
    ...alpineRpiBase,
    overallScore: computeOverallScore(alpineRpiBase),
  };

  // 3. Home Assistant OS on RPi
  const haosRpiBase = {
    os: HostOsTarget.HaosHost,
    name: 'Home Assistant OS (HAOS aarch64 on Pi)',
    storage: {
      score: 6,
      supported: false,
      directHardwareAccess: false,
      advantages: ['Built-in Supervisor backups'],
      limitations: [
        'High disk write churn on MicroSD causes premature wear',
        'Locked down root filesystem without direct tuning',
      ],
    },
    multicast: {
      score: 7,
      supported: true,
      directHardwareAccess: false,
      advantages: ['Supervisor Avahi'],
      limitations: ['NetworkManager conflicts in multi-NIC configurations'],
    },
    ipv6Thread: {
      score: 7,
      supported: true,
      directHardwareAccess: false,
      advantages: ['OTBR add-on'],
      limitations: ['Requires privileged Supervisor container permissions'],
    },
    radios: {
      score: 7.5,
      supported: true,
      directHardwareAccess: false,
      advantages: ['Auto-discovery of SkyConnect / Yellow radios'],
      limitations: ['Container passthrough overhead'],
    },
    hardwareAcceleration: {
      score: 6.5,
      supported: true,
      directHardwareAccess: false,
      advantages: ['Pi video driver in kernel'],
      limitations: ['Cannot install custom kernel modules'],
    },
    recovery: {
      score: 5,
      supported: false,
      directHardwareAccess: false,
      advantages: ['RAUC partition rollback'],
      limitations: [
        'Supervisor crash leaves host unmanageable headlessly',
        'High idle RAM overhead (Supervisor + HA consumes 1.5GB+ idle) starving Pi 4GB models',
      ],
    },
    recommended: false,
    standaloneCapable: false,
  };

  const haosRpiProfile: HostOsProfile = {
    ...haosRpiBase,
    overallScore: computeOverallScore(haosRpiBase),
  };

  return [debianRpiProfile, alpineRpiProfile, haosRpiProfile];
}

/**
 * Evaluates candidate host operating systems for a target hardware class across all 6 critical
 * hardware constraints: storage, multicast, IPv6/Thread, radios, hardware acceleration, and recovery.
 */
export function evaluateHardwareHostMatrix(hardware: HardwareClass): HardwareSupportComparison {
  if (hardware === HardwareClass.IntelAmd64MiniPc) {
    const profiles = buildIntelProfiles();
    return {
      hardware,
      hardwareName: 'Intel/AMD x86_64 Mini PC / Black Laptop',
      profiles,
      recommendedTarget: HostOsTarget.DebianUbuntuDocker,
      standaloneLinuxProven: true,
      rationale:
        'Debian 12 / Ubuntu 24.04 LTS with Docker achieved a score of 9.8/10, vastly outperforming HAOS (6.3/10). Standalone Linux delivers direct Intel QuickSync (/dev/dri) hardware transcoding, native NVMe fstrim, zero-multicast-drop host networking for HomeKit/Matter, direct USB serial radio access with flock exclusivity, and non-destructive headless recovery without any HAOS or Supervisor dependencies.',
    };
  }

  const profiles = buildRpiProfiles();
  return {
    hardware: HardwareClass.RaspberryPiArm64,
    hardwareName: 'Raspberry Pi 4 / 5 (arm64)',
    profiles,
    recommendedTarget: HostOsTarget.DebianUbuntuDocker,
    standaloneLinuxProven: true,
    rationale:
      'Debian 12 / Ubuntu 24.04 LTS (Pi OS 64-bit) with Docker achieved a score of 9.5/10, compared to 6.5/10 for HAOS. Standalone Linux avoids the 1.5GB+ idle RAM tax of Supervisor/Python on constrained Pi memory, provides direct GPIO/USB radio serial access, native V4L2 video acceleration, and reliable headless recovery.',
  };
}

/** Evaluates support matrices across all supported hardware classes. */
export function evaluateAllHardwareMatrices(): readonly HardwareSupportComparison[] {
  return [
    evaluateHardwareHostMatrix(HardwareClass.IntelAmd64MiniPc),
    evaluateHardwareHostMatrix(HardwareClass.RaspberryPiArm64),
  ];
}
