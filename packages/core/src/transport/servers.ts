/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type ServerKind = 'hub' | 'nvr' | 'home-assistant' | 'ssh';

export type ServerDetailTabId = 'overview' | 'storage' | 'services' | 'nvr' | 'logs' | 'terminal';

export type ServerConnectionState = 'online' | 'paused' | 'offline' | 'unknown';

export interface ServerDiskRecord {
  readonly id: string;
  readonly name: string;
  readonly mountpoint: string | null;
  readonly filesystem: string | null;
  readonly totalBytes: number | null;
  readonly usedBytes: number | null;
  readonly availableBytes: number | null;
}

export interface ServerServiceRow {
  readonly id: string;
  readonly name: string;
  readonly manager: 'docker' | 'pm2' | 'systemServices';
  readonly running: boolean;
  readonly status: string;
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly uptimeSeconds: number | null;
}

export interface ServerNvrSummary {
  readonly hasNvr: boolean;
  readonly storageAssigned: boolean;
  readonly streamingAssigned: boolean;
  readonly activeStreams?: string;
  readonly playbackPrep?: string;
  readonly activityAssist?: string;
  readonly backupCopies?: number;
  readonly usedBytes?: number | null;
  readonly limitBytes?: number | null;
}

export interface ServerGraphicsAdapterRecord {
  readonly name: string;
  readonly vendor?: string;
  readonly utilization?: number | null;
  readonly memoryUsedBytes?: number | null;
  readonly memoryTotalBytes?: number | null;
}

export interface ServerResourceSample {
  readonly time: number;
  readonly cpu: number | null;
  readonly memory: number | null;
  readonly swap: number | null;
}

export interface ServerSummaryRecord {
  readonly id: string;
  readonly managedId?: string;
  readonly name: string;
  readonly kind: ServerKind;
  readonly roomId?: string;
  readonly roomName?: string;
  readonly icon?: string;
  readonly favorite?: boolean;
  readonly hostname?: string;
  readonly platform?: string;
  readonly architecture?: string;
  readonly reportingScope?: 'host' | 'container';
  readonly online: boolean | null;
  readonly enabled: boolean;
  readonly local?: boolean;
  readonly url?: string;
  readonly lastSeen?: number | string;
  readonly osLabel: string;
  readonly cpuModel: string;
  readonly cpuCores: number | null;
  readonly cpuUsage: number | null;
  readonly loadAverageLabel: string;
  readonly memoryUsedBytes: number | null;
  readonly memoryTotalBytes: number | null;
  readonly memoryInstalledBytes?: number | null;
  readonly swapSupported?: boolean;
  readonly swapUsedBytes?: number | null;
  readonly swapTotalBytes?: number | null;
  readonly uptimeSeconds: number | null;
  readonly batteryLevel?: number | null;
  readonly batteryCharging?: boolean;
  readonly graphics?: readonly ServerGraphicsAdapterRecord[];
  readonly disks: readonly ServerDiskRecord[];
  readonly services: readonly ServerServiceRow[];
  readonly nvr?: ServerNvrSummary;
  readonly error?: string;
}

export interface DemoServersState {
  readonly servers: readonly ServerSummaryRecord[];
  readonly logsByServerId: Readonly<Record<string, string>>;
  readonly historyByServerId?: Readonly<Record<string, readonly ServerResourceSample[]>>;
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 100 || unitIndex === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unitIndex]}`;
}

export function formatRatio(used?: number | null, total?: number | null): number | null {
  if (
    used === undefined ||
    used === null ||
    total === undefined ||
    total === null ||
    !Number.isFinite(used) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(1, used / total));
}

export function formatPercent(ratio?: number | null): string {
  if (ratio === undefined || ratio === null || !Number.isFinite(ratio)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

export function formatUptime(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86_400);
  const hours = Math.floor((whole % 86_400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function stripAnsiSequences(input: string): string {
  let result = '';
  let i = 0;
  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (code === 0x1b) {
      const next = input[i + 1];
      if (next === '[') {
        i += 2;
        while (i < input.length && !/@|~|[A-Za-z]/.test(input[i] ?? '')) i += 1;
        i += 1;
        continue;
      }
      if (next === ']') {
        i += 2;
        while (i < input.length) {
          if (input.charCodeAt(i) === 0x07) {
            i += 1;
            break;
          }
          if (input.charCodeAt(i) === 0x1b && input[i + 1] === '\\') {
            i += 2;
            break;
          }
          i += 1;
        }
        continue;
      }
      i += 2;
      continue;
    }
    if (code === 0x0d) {
      i += 1;
      continue;
    }
    result += input[i] ?? '';
    i += 1;
  }
  return result;
}

export function appendTerminalOutput(existing: string, chunk: string, maxLines = 400): string {
  const clean = stripAnsiSequences(chunk);
  if (!clean) return existing;
  const combined = existing + clean;
  const lines = combined.split('\n');
  if (lines.length <= maxLines) return combined;
  return lines.slice(lines.length - maxLines).join('\n');
}

export function resolveServerConnectionState(server: {
  readonly online: boolean | null;
  readonly enabled?: boolean;
}): ServerConnectionState {
  if (server.enabled === false) return 'paused';
  if (server.online === true) return 'online';
  if (server.online === false) return 'offline';
  return 'unknown';
}

export function summarizeServerDisks(disks: readonly ServerDiskRecord[]): {
  readonly totalBytes: number;
  readonly usedBytes: number;
  readonly availableBytes: number;
  readonly usageRatio: number | null;
  readonly volumeCount: number;
} {
  let totalBytes = 0;
  let usedBytes = 0;
  let availableBytes = 0;
  for (const disk of disks) {
    if (typeof disk.totalBytes === 'number' && disk.totalBytes > 0) totalBytes += disk.totalBytes;
    if (typeof disk.usedBytes === 'number' && disk.usedBytes >= 0) usedBytes += disk.usedBytes;
    if (typeof disk.availableBytes === 'number' && disk.availableBytes >= 0) {
      availableBytes += disk.availableBytes;
    }
  }
  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usageRatio: formatRatio(usedBytes, totalBytes),
    volumeCount: disks.length,
  };
}

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
    Array.from({ length: 36 }, (_, idx) => {
      const t = now - (35 - idx) * 1500;
      const w = (idx + phase) * 0.42;
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
      architecture: 'arm64',
      reportingScope: 'host',
      favorite: true,
      online: true,
      enabled: true,
      local: true,
      url: 'https://willow-hub.local',
      osLabel: 'Ubuntu 24.04 LTS · Linux 6.8 arm64',
      cpuModel: 'Apple M2 / ARMv8.5',
      cpuCores: 8,
      cpuUsage: 0.18,
      loadAverageLabel: '0.42 · 0.39 · 0.36',
      memoryUsedBytes: 6.4 * 1024 ** 3,
      memoryTotalBytes: 16 * 1024 ** 3,
      memoryInstalledBytes: 16 * 1024 ** 3,
      swapSupported: true,
      swapUsedBytes: 384 * 1024 ** 2,
      swapTotalBytes: 4 * 1024 ** 3,
      uptimeSeconds: 18 * 86_400 + 6 * 3600,
      disks: [
        {
          id: 'nvme0n1p2',
          name: 'System NVMe',
          mountpoint: '/',
          filesystem: 'ext4',
          totalBytes: 930 * 1024 ** 3,
          usedBytes: 312 * 1024 ** 3,
          availableBytes: 618 * 1024 ** 3,
        },
        {
          id: 'nvme0n1p3',
          name: 'Backups & Snapshots',
          mountpoint: '/srv/backups',
          filesystem: 'btrfs',
          totalBytes: 512 * 1024 ** 3,
          usedBytes: 168 * 1024 ** 3,
          availableBytes: 344 * 1024 ** 3,
        },
      ],
      services: [
        {
          id: 'haus-hub.service',
          name: 'Haus Hub Core',
          manager: 'systemServices',
          running: true,
          status: 'active',
          cpuPercent: 4.2,
          memoryBytes: 410 * 1024 ** 2,
          uptimeSeconds: 18 * 86_400,
        },
        {
          id: 'zigbee2mqtt',
          name: 'Zigbee2MQTT',
          manager: 'docker',
          running: true,
          status: 'running',
          cpuPercent: 1.8,
          memoryBytes: 185 * 1024 ** 2,
          uptimeSeconds: 18 * 86_400,
        },
        {
          id: 'go2rtc',
          name: 'Haus Media Relay',
          manager: 'docker',
          running: true,
          status: 'running',
          cpuPercent: 6.1,
          memoryBytes: 320 * 1024 ** 2,
          uptimeSeconds: 18 * 86_400,
        },
      ],
      nvr: {
        hasNvr: true,
        storageAssigned: true,
        streamingAssigned: true,
        activeStreams: '2 / 8',
        playbackPrep: '0 / 2',
        activityAssist: '1 / 2',
        backupCopies: 3,
        usedBytes: 140 * 1024 ** 3,
        limitBytes: 500 * 1024 ** 3,
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
      architecture: 'arm64',
      reportingScope: 'host',
      online: true,
      enabled: true,
      local: true,
      osLabel: 'Debian 12 · Linux 6.6 arm64',
      cpuModel: 'Broadcom BCM2712',
      cpuCores: 4,
      cpuUsage: 0.34,
      loadAverageLabel: '0.88 · 0.74 · 0.71',
      memoryUsedBytes: 3.1 * 1024 ** 3,
      memoryTotalBytes: 8 * 1024 ** 3,
      memoryInstalledBytes: 8 * 1024 ** 3,
      swapSupported: true,
      swapUsedBytes: 120 * 1024 ** 2,
      swapTotalBytes: 2 * 1024 ** 3,
      uptimeSeconds: 9 * 86_400 + 2 * 3600,
      disks: [
        {
          id: 'recordings-raid',
          name: 'Camera Archive Array',
          mountpoint: '/srv/recordings',
          filesystem: 'btrfs',
          totalBytes: 3600 * 1024 ** 3,
          usedBytes: 1420 * 1024 ** 3,
          availableBytes: 2180 * 1024 ** 3,
        },
      ],
      services: [
        {
          id: 'haus-node.service',
          name: 'Haus Node Agent',
          manager: 'pm2',
          running: true,
          status: 'online',
          cpuPercent: 8.4,
          memoryBytes: 290 * 1024 ** 2,
          uptimeSeconds: 9 * 86_400,
        },
      ],
      nvr: {
        hasNvr: true,
        storageAssigned: true,
        streamingAssigned: true,
        activeStreams: '1 / 4',
        playbackPrep: '0 / 1',
        activityAssist: '1 / 1',
        backupCopies: 12,
        usedBytes: 1420 * 1024 ** 3,
        limitBytes: 3000 * 1024 ** 3,
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
