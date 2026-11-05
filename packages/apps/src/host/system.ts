/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { constants } from 'node:fs';
import { access, readdir, statfs } from 'node:fs/promises';
import * as os from 'node:os';
import type { AppArchitecture } from '../manifest.js';
import type {
  HostAdapter,
  HostCpuMetrics,
  HostDeviceNode,
  HostDiskUsage,
  HostMemoryMetrics,
  HostMetrics,
  HostNetworkInterface,
  HostSystemInfo,
} from './types.js';

function mapNodeArchToAppArch(arch: string): AppArchitecture {
  switch (arch) {
    case 'x64':
      return 'amd64';
    case 'arm64':
      return 'arm64';
    case 'arm':
      return 'armv7';
    case 'ia32':
      return 'i386';
    default:
      return 'amd64';
  }
}

const VIRTUAL_IFACE_PREFIXES = [
  'lo',
  'docker',
  'br-',
  'veth',
  'vmnet',
  'tun',
  'tap',
  'tailscale',
  'cni',
  'flannel',
  'dummy',
  'virbr',
  'bridge',
  'gif',
  'stf',
  'awdl',
  'llw',
  'ap',
  'anpi',
];

export function isPhysicalNetworkInterface(name: string): boolean {
  const lower = name.toLowerCase();
  for (const prefix of VIRTUAL_IFACE_PREFIXES) {
    if (lower === prefix || lower.startsWith(prefix)) {
      return false;
    }
  }
  return true;
}

export class SystemHostAdapter implements HostAdapter {
  constructor(private readonly diskPaths: readonly string[] = ['/', '/data']) {}

  async getMetrics(): Promise<HostMetrics> {
    const cpus = os.cpus();
    let totalTick = 0;
    let userTick = 0;
    let sysTick = 0;

    for (const cpu of cpus) {
      userTick += cpu.times.user;
      sysTick += cpu.times.sys;
      totalTick +=
        cpu.times.user +
        cpu.times.nice +
        cpu.times.sys +
        cpu.times.idle +
        cpu.times.irq;
    }

    const totalPercent = totalTick > 0 ? Math.round(((userTick + sysTick) / totalTick) * 100) : 0;
    const userPercent = totalTick > 0 ? Math.round((userTick / totalTick) * 100) : 0;
    const systemPercent = totalTick > 0 ? Math.round((sysTick / totalTick) * 100) : 0;
    const loadAvg = os.loadavg() as [number, number, number];

    const cpuMetrics: HostCpuMetrics = {
      totalPercent,
      userPercent,
      systemPercent,
      cores: cpus.length,
      loadAvg,
    };

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;

    const memoryMetrics: HostMemoryMetrics = {
      totalBytes: totalMem,
      usedBytes: usedMem,
      freeBytes: freeMem,
      availableBytes: freeMem,
      usedPercent: memPercent,
    };

    const platform = os.platform();
    const normalizedPlatform =
      platform === 'linux' || platform === 'darwin' || platform === 'win32'
        ? platform
        : 'unknown';

    const systemInfo: HostSystemInfo = {
      platform: normalizedPlatform,
      arch: mapNodeArchToAppArch(os.arch()),
      kernelRelease: os.release(),
      hostname: os.hostname(),
      uptimeSeconds: Math.round(os.uptime()),
    };

    return {
      cpu: cpuMetrics,
      memory: memoryMetrics,
      system: systemInfo,
    };
  }

  async getDiskUsage(): Promise<readonly HostDiskUsage[]> {
    const usages: HostDiskUsage[] = [];

    for (const mountPoint of this.diskPaths) {
      try {
        const stat = await statfs(mountPoint);
        const total = Number(stat.blocks) * Number(stat.bsize);
        const free = Number(stat.bfree) * Number(stat.bsize);
        const available = Number(stat.bavail) * Number(stat.bsize);
        const used = total - free;
        const usedPercent = total > 0 ? Math.round((used / total) * 100) : 0;

        usages.push({
          mountPoint,
          fsType: `type_${stat.type.toString(16)}`,
          totalBytes: total,
          usedBytes: used,
          availableBytes: available,
          usedPercent,
        });
      } catch {
        // Path does not exist or unreadable, safely continue
      }
    }

    return usages;
  }

  async getNetworkInterfaces(): Promise<readonly HostNetworkInterface[]> {
    const interfaces = os.networkInterfaces();
    const result: HostNetworkInterface[] = [];

    for (const [name, infos] of Object.entries(interfaces)) {
      if (!infos || infos.length === 0) continue;

      const physical = isPhysicalNetworkInterface(name);
      let mac = '';
      const addresses: HostNetworkInterface['addresses'][number][] = [];

      for (const info of infos) {
        if (!mac && info.mac && info.mac !== '00:00:00:00:00:00') {
          mac = info.mac;
        }
        addresses.push({
          ip: info.address,
          family: info.family as 'IPv4' | 'IPv6',
          internal: info.internal,
          netmask: info.netmask,
        });
      }

      result.push({
        name,
        physical,
        mac: mac || '00:00:00:00:00:00',
        addresses,
        operstate: infos.some((i) => !i.internal) ? 'up' : 'unknown',
      });
    }

    return result;
  }

  async getDeviceNodes(): Promise<readonly HostDeviceNode[]> {
    const nodes: HostDeviceNode[] = [];

    try {
      const devEntries = await readdir('/dev');

      for (const entry of devEntries) {
        const fullPath = `/dev/${entry}`;

        if (
          entry.startsWith('ttyUSB') ||
          entry.startsWith('ttyACM') ||
          entry.startsWith('ttyAMA') ||
          entry.startsWith('cu.usb') ||
          entry.startsWith('tty.usb')
        ) {
          const accessible = await this.checkDeviceAccess(fullPath);
          nodes.push({
            path: fullPath,
            type: 'serial',
            accessible,
            description: `Serial port ${entry}`,
          });
        } else if (entry.startsWith('video')) {
          const accessible = await this.checkDeviceAccess(fullPath);
          nodes.push({
            path: fullPath,
            type: 'video',
            accessible,
            description: `Video device ${entry}`,
          });
        }
      }

      // Check DRI subfolder for GPUs
      try {
        const driEntries = await readdir('/dev/dri');
        for (const entry of driEntries) {
          const fullPath = `/dev/dri/${entry}`;
          const accessible = await this.checkDeviceAccess(fullPath);
          nodes.push({
            path: fullPath,
            type: 'gpu',
            accessible,
            description: `DRI device ${entry}`,
          });
        }
      } catch {
        // /dev/dri does not exist on non-Linux or systems without DRI
      }
    } catch {
      // /dev unreadable or platform not supporting direct readdir
    }

    return nodes;
  }

  async checkDeviceAccess(path: string, mode: 'r' | 'w' | 'rw' = 'rw'): Promise<boolean> {
    let mask = 0;
    if (mode.includes('r')) mask |= constants.R_OK;
    if (mode.includes('w')) mask |= constants.W_OK;
    if (mask === 0) mask = constants.R_OK;

    try {
      await access(path, mask);
      return true;
    } catch {
      return false;
    }
  }
}

export class FakeHostAdapter implements HostAdapter {
  constructor(
    private readonly metrics: HostMetrics = {
      cpu: {
        totalPercent: 12,
        userPercent: 8,
        systemPercent: 4,
        cores: 8,
        loadAvg: [0.5, 0.4, 0.3],
      },
      memory: {
        totalBytes: 16 * 1024 * 1024 * 1024,
        usedBytes: 4 * 1024 * 1024 * 1024,
        freeBytes: 12 * 1024 * 1024 * 1024,
        availableBytes: 12 * 1024 * 1024 * 1024,
        usedPercent: 25,
      },
      system: {
        platform: 'linux',
        arch: 'amd64',
        kernelRelease: '6.6.0-haus',
        hostname: 'haus-node-primary',
        uptimeSeconds: 86400,
      },
    },
    private readonly diskUsage: readonly HostDiskUsage[] = [
      {
        mountPoint: '/',
        fsType: 'ext4',
        totalBytes: 500 * 1024 * 1024 * 1024,
        usedBytes: 50 * 1024 * 1024 * 1024,
        availableBytes: 450 * 1024 * 1024 * 1024,
        usedPercent: 10,
      },
    ],
    private readonly networkInterfaces: readonly HostNetworkInterface[] = [
      {
        name: 'eth0',
        physical: true,
        mac: '52:54:00:12:34:56',
        operstate: 'up',
        addresses: [
          { ip: '192.168.1.100', family: 'IPv4', internal: false, netmask: '255.255.255.0' },
        ],
      },
    ],
    private readonly deviceNodes: readonly HostDeviceNode[] = [
      {
        path: '/dev/ttyUSB0',
        type: 'serial',
        accessible: true,
        description: 'Zigbee Coordinator Dongle',
      },
    ],
    private readonly accessiblePaths: Set<string> = new Set(['/dev/ttyUSB0']),
  ) {}

  async getMetrics(): Promise<HostMetrics> {
    return this.metrics;
  }

  async getDiskUsage(): Promise<readonly HostDiskUsage[]> {
    return this.diskUsage;
  }

  async getNetworkInterfaces(): Promise<readonly HostNetworkInterface[]> {
    return this.networkInterfaces;
  }

  async getDeviceNodes(): Promise<readonly HostDeviceNode[]> {
    return this.deviceNodes;
  }

  async checkDeviceAccess(path: string): Promise<boolean> {
    return this.accessiblePaths.has(path);
  }
}
