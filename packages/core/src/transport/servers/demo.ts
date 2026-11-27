/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { DemoServersState, ServerResourceSample, ServerSummaryRecord } from '../servers.js';
import { SERVER_GIB } from './metrics.js';

export function runDemoTerminalCommand(
  serverName: string,
  command: string,
): { readonly output: string; readonly clear?: boolean } {
  const trimmed = command.trim();
  const cmd = trimmed.toLowerCase();
  if (!trimmed) return { output: '' };
  if (cmd === 'clear') return { output: '', clear: true };
  if (cmd === 'help') {
    return {
      output: `$ ${trimmed}\nAvailable demo commands: help, uptime, uname -a, df -h, docker ps, clear\n`,
    };
  }
  if (cmd === 'uptime') {
    return {
      output: `$ ${trimmed}\n 03:12:00 up 18 days,  6:41,  1 user,  load average: 0.42, 0.39, 0.36\n`,
    };
  }
  if (cmd === 'uname -a') {
    return {
      output: `$ ${trimmed}\nLinux ${serverName.toLowerCase().replace(/\s+/g, '-')} 6.8.0-48-generic aarch64 GNU/Linux\n`,
    };
  }
  if (cmd === 'df -h') {
    return {
      output: `$ ${trimmed}\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p2  930G  312G  618G  34% /\n/dev/sda1       3.6T  1.4T  2.2T  39% /srv/recordings\n`,
    };
  }
  if (cmd === 'docker ps') {
    return {
      output: `$ ${trimmed}\nCONTAINER ID   IMAGE                        STATUS\na19f4c28d102   ghcr.io/haus/hub:2026.11     Up 18 days (healthy)\nb88201e7f319   ghcr.io/haus/go2rtc:1.9.8    Up 18 days (healthy)\n`,
    };
  }
  return {
    output: `$ ${trimmed}\n[demo shell on ${serverName}] executed '${trimmed}' (type 'help' for built-ins)\n`,
  };
}

export function buildDemoServersState(): DemoServersState {
  const now = Date.now();
  const buildWave = (
    baseCpu: number,
    baseMem: number,
    baseSwap: number,
    phase: number,
  ): ServerResourceSample[] =>
    Array.from({ length: 62 }, (_, idx) => {
      const t = now - (61 - idx) * 1000;
      const w = (idx + phase) * 0.28;
      return {
        time: t,
        cpu: Math.max(
          0.03,
          Math.min(0.95, baseCpu + Math.sin(w) * 0.045 + Math.cos(w * 0.5) * 0.02),
        ),
        memory: Math.max(0.08, Math.min(0.96, baseMem + Math.sin(w * 0.3) * 0.015)),
        swap: Math.max(0, Math.min(0.9, baseSwap + Math.cos(w * 0.25) * 0.006)),
      };
    });

  const servers: ServerSummaryRecord[] = [
    {
      id: 'haus-hub-main',
      managedId: 'haus-hub-main',
      name: 'Willow Hub',
      kind: 'hub',
      roomName: 'Utility',
      hostname: 'willow-hub.local',
      platform: 'linux',
      distribution: 'Ubuntu',
      osName: 'Ubuntu 24.04 LTS',
      architecture: 'arm64',
      reportingScope: 'host',
      metricsScopeLabel: 'Host system',
      favorite: true,
      online: true,
      enabled: true,
      local: true,
      url: 'https://willow-hub.local',
      sampledAt: new Date(now).toISOString(),
      osLabel: 'Ubuntu 24.04 LTS · arm64',
      cpuModel: 'Apple M2 / ARMv8.5',
      cpuCores: 8,
      cpuUsage: 0.18,
      loadAverageLabel: '0.42 · 0.39 · 0.36',
      memoryUsedBytes: 6.4 * SERVER_GIB,
      memoryTotalBytes: 16 * SERVER_GIB,
      memoryInstalledBytes: 16 * SERVER_GIB,
      swapSupported: true,
      swapUsedBytes: 384 * 1024 ** 2,
      swapTotalBytes: 4 * SERVER_GIB,
      uptimeSeconds: 18 * 86_400 + 6 * 3600,
      disks: [
        {
          id: 'nvme0n1',
          name: 'Samsung PM9A1 NVMe',
          kind: 'disk',
          type: 'disk',
          physical: true,
          parentId: null,
          mountpoint: null,
          filesystem: null,
          totalBytes: 1443 * SERVER_GIB,
          usedBytes: null,
          availableBytes: null,
          device: '/dev/nvme0n1',
          transport: 'nvme',
          mediaKind: 'ssd',
          removable: false,
          hotplug: false,
        },
        {
          id: 'nvme0n1p1',
          name: 'EFI',
          kind: 'volume',
          type: 'partition',
          parentId: 'nvme0n1',
          partitionRole: 'efi',
          partitionNumber: 1,
          mountpoint: '/boot/efi',
          filesystem: 'vfat',
          totalBytes: 1 * SERVER_GIB,
          usedBytes: 64 * 1024 ** 2,
          availableBytes: 960 * 1024 ** 2,
          device: '/dev/nvme0n1p1',
        },
        {
          id: 'nvme0n1p2',
          name: 'System Root',
          kind: 'volume',
          type: 'partition',
          parentId: 'nvme0n1',
          partitionRole: 'system',
          partitionNumber: 2,
          mountpoint: '/',
          filesystem: 'ext4',
          totalBytes: 930 * SERVER_GIB,
          usedBytes: 312 * SERVER_GIB,
          availableBytes: 618 * SERVER_GIB,
          device: '/dev/nvme0n1p2',
          readOnly: false,
        },
        {
          id: 'nvme0n1p3',
          name: 'Backups & Snapshots',
          kind: 'volume',
          type: 'partition',
          parentId: 'nvme0n1',
          partitionRole: 'data',
          partitionNumber: 3,
          mountpoint: '/srv/backups',
          filesystem: 'btrfs',
          totalBytes: 512 * SERVER_GIB,
          usedBytes: 168 * SERVER_GIB,
          availableBytes: 344 * SERVER_GIB,
          device: '/dev/nvme0n1p3',
          readOnly: false,
        },
      ],
      services: [
        {
          id: 'sys:haus-hub.service',
          rawId: 'haus-hub.service',
          name: 'Haus Hub Core',
          manager: 'systemServices',
          running: true,
          status: 'active',
          subtitle: 'PID 1142',
          trailing: '18d 6h',
          cpuPercent: 0.525,
          memoryBytes: 410 * 1024 ** 2,
          uptimeSeconds: 18 * 86_400,
        },
        {
          id: 'docker:zigbee2mqtt',
          rawId: 'zigbee2mqtt',
          name: 'Zigbee2MQTT',
          manager: 'docker',
          running: true,
          status: 'running',
          subtitle: 'a19f4c28d102',
          trailing: 'koenkk/zigbee2mqtt:latest',
          cpuPercent: 0.225,
          memoryBytes: 185 * 1024 ** 2,
          uptimeSeconds: 18 * 86_400,
        },
        {
          id: 'docker:go2rtc',
          rawId: 'go2rtc',
          name: 'Haus Media Relay',
          manager: 'docker',
          running: true,
          status: 'running',
          subtitle: 'b88201e7f319',
          trailing: 'ghcr.io/haus/go2rtc:1.9.8',
          cpuPercent: 0.7625,
          memoryBytes: 320 * 1024 ** 2,
          uptimeSeconds: 18 * 86_400,
        },
      ],
      nvr: {
        hasNvr: true,
        hasSettings: true,
        storageAssigned: true,
        streamingAssigned: true,
        activeStreams: '2 / 8',
        playbackPrep: '0 / 2',
        activityAssist: '1 / 2',
        backupCopies: 3,
        usedBytes: 140 * SERVER_GIB,
        limitBytes: 500 * SERVER_GIB,
        freeBytes: 618 * SERVER_GIB,
        availableBytes: 360 * SERVER_GIB,
        usage: {
          sampledAt: now,
          complete: true,
          logicalBytes: 140 * SERVER_GIB,
          allocatedBytes: 141 * SERVER_GIB,
          categories: [
            {
              id: 'originals',
              logicalBytes: 112 * SERVER_GIB,
              allocatedBytes: 112 * SERVER_GIB,
              files: 1840,
            },
            {
              id: 'prepared',
              logicalBytes: 18 * SERVER_GIB,
              allocatedBytes: 19 * SERVER_GIB,
              files: 420,
            },
            {
              id: 'snapshots',
              logicalBytes: 6 * SERVER_GIB,
              allocatedBytes: 6 * SERVER_GIB,
              files: 9210,
            },
            {
              id: 'databases',
              logicalBytes: 4 * SERVER_GIB,
              allocatedBytes: 4 * SERVER_GIB,
              files: 12,
            },
          ],
        },
      },
    },
    {
      id: 'nvr-node-garage',
      managedId: 'nvr-node-garage',
      name: 'Garage NVR Node',
      kind: 'nvr',
      roomName: 'Garage',
      hostname: 'garage-nvr.local',
      platform: 'linux',
      distribution: 'Raspberry Pi OS',
      osName: 'Raspberry Pi OS 12 (bookworm)',
      architecture: 'arm64',
      reportingScope: 'host',
      metricsScopeLabel: 'Host system',
      online: true,
      enabled: true,
      local: false,
      sampledAt: new Date(now).toISOString(),
      osLabel: 'Raspberry Pi OS 12 · arm64',
      cpuModel: 'Broadcom BCM2712',
      cpuCores: 4,
      cpuUsage: 0.34,
      loadAverageLabel: '0.88 · 0.74 · 0.71',
      memoryUsedBytes: 3.1 * SERVER_GIB,
      memoryTotalBytes: 8 * SERVER_GIB,
      memoryInstalledBytes: 8 * SERVER_GIB,
      swapSupported: true,
      swapUsedBytes: 120 * 1024 ** 2,
      swapTotalBytes: 2 * SERVER_GIB,
      uptimeSeconds: 9 * 86_400 + 2 * 3600,
      disks: [
        {
          id: 'recordings-raid',
          name: 'Camera Archive Array',
          kind: 'volume',
          type: 'volume',
          mountpoint: '/srv/recordings',
          filesystem: 'btrfs',
          totalBytes: 3600 * SERVER_GIB,
          usedBytes: 1420 * SERVER_GIB,
          availableBytes: 2180 * SERVER_GIB,
          mediaKind: 'hdd',
          transport: 'usb',
          removable: true,
          hotplug: true,
        },
      ],
      services: [
        {
          id: 'pm2:haus-node',
          rawId: 'haus-node',
          name: 'Haus Node Agent',
          manager: 'pm2',
          running: true,
          status: 'online',
          subtitle: 'PID 902 · 0 restarts',
          trailing: '9d 2h',
          cpuPercent: 2.1,
          memoryBytes: 290 * 1024 ** 2,
          uptimeSeconds: 9 * 86_400,
        },
      ],
      nvr: {
        hasNvr: true,
        hasSettings: true,
        storageAssigned: true,
        streamingAssigned: true,
        activeStreams: '1 / 4',
        playbackPrep: '0 / 1',
        activityAssist: '1 / 1',
        backupCopies: 12,
        usedBytes: 1420 * SERVER_GIB,
        limitBytes: 3000 * SERVER_GIB,
        freeBytes: 2180 * SERVER_GIB,
        availableBytes: 1580 * SERVER_GIB,
      },
    },
  ];
  const logsByServerId: Record<string, string> = {
    'haus-hub-main':
      '[03:09:11] [hub] Direct E2EE IPC listener active on :8443\n[03:10:04] [mqtt] Broker synced 28 devices (0 offline)\n[03:11:42] [nvr] Verified archive chunk 20261124-031100.mp4\n',
    'nvr-node-garage':
      '[03:08:50] [node] Connected to Willow Hub as verified NVR peer\n[03:11:30] [motion] Driveway clip archived cleanly (1.8 MB)\n',
  };
  const historyByServerId: Record<string, readonly ServerResourceSample[]> = {
    'haus-hub-main': buildWave(0.18, 0.4, 0.09, 0),
    'nvr-node-garage': buildWave(0.34, 0.39, 0.06, 2.2),
  };
  return { servers, logsByServerId, historyByServerId };
}
