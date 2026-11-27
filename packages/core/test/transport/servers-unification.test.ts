/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  buildServiceGroupSummary,
  computeDuoBarGaugeMetrics,
  computeServerDiskSpace,
  computeServiceUsageScore,
  isGroupedPm2SystemUnit,
  normalizeServiceCpuPercent,
  orderServerDisks,
  resolveServerIcon,
  resolveServiceCpuBasis,
  serverDiskDepth,
  summarizeServerDisks,
  type ServerDiskRecord,
} from '../../src/transport/servers.js';

describe('server metrics, DuoBar math, distro icons, and disk hierarchy unification', () => {
  it('normalizes core-basis container/PM2/systemd CPU by logical cores and computes exact L4 DuoBar score', () => {
    expect(resolveServiceCpuBasis({ cpuPercentBasis: 'core' }, 'docker')).toBe('core');
    expect(resolveServiceCpuBasis({ source: 'pm2' }, 'pm2')).toBe('core');
    expect(resolveServiceCpuBasis({ source: 'systemd' }, 'systemServices')).toBe('core');
    expect(resolveServiceCpuBasis({ source: 'docker' }, 'docker')).toBeNull();

    // 80% of one core on an 8-core server = 10% of host CPU
    expect(normalizeServiceCpuPercent(80, 'core', 8)).toBeCloseTo(10, 5);
    expect(normalizeServiceCpuPercent(25, 'host', 8)).toBeCloseTo(25, 5);

    // L4 norm: cpuShare = 0.2, memShare = 0.5 -> (0.2^4 + 0.5^4)^0.25
    const expected = (0.2 ** 4 + 0.5 ** 4) ** 0.25;
    expect(computeServiceUsageScore(20, 4_000, 8_000)).toBeCloseTo(expected, 6);

    // System mode ('All' tab) uses cpuRatio directly for usage readout
    const sysMetrics = computeDuoBarGaugeMetrics({
      cpuPercent: 18,
      memoryBytes: 6_000,
      totalMemoryBytes: 8_000,
      system: true,
    });
    expect(sysMetrics.usage).toBeCloseTo(0.18, 6);
  });

  it('tracks incomplete service group totals with partial flags and filters PM2 systemd wrappers', () => {
    expect(isGroupedPm2SystemUnit('pm2-resonaura.service')).toBe(true);
    expect(isGroupedPm2SystemUnit('wsl:pm2.service')).toBe(true);
    expect(isGroupedPm2SystemUnit('haus-hub.service')).toBe(false);

    const group = buildServiceGroupSummary({
      id: 'docker',
      name: 'Docker',
      source: 'docker',
      measured: true,
      rows: [
        { name: 'go2rtc', running: true, cpuPercent: 4.5, memoryBytes: 100 },
        { name: 'mqtt', running: true, cpuPercent: null, memoryBytes: 50 },
      ],
    });
    expect(group.active).toBe(2);
    expect(group.cpuPercent).toBeCloseTo(4.5, 5);
    expect(group.cpuIncomplete).toBe(true);
    expect(group.memoryBytes).toBe(150);
    expect(group.memoryIncomplete).toBe(false);
  });

  it('resolves OS distro and server identity icons deterministically', () => {
    expect(
      resolveServerIcon({
        name: 'Coordinator',
        host: { platform: 'linux', distribution: 'Raspberry Pi OS' },
      }),
    ).toBe('raspberry-pi');
    expect(
      resolveServerIcon({
        name: 'Node',
        host: { platform: 'linux', osName: 'Ubuntu 24.04.1 LTS' },
      }),
    ).toBe('ubuntu');
    // Generic kernel suffix never implies Ubuntu
    expect(
      resolveServerIcon({
        name: 'Generic',
        host: { platform: 'linux', release: '6.8.0-48-generic' },
      }),
    ).toBe('linux');
    // WSL belongs to Windows physical machine
    expect(
      resolveServerIcon({
        name: 'Workstation',
        host: { platform: 'linux', release: '5.15.167.4-microsoft-standard-WSL2' },
      }),
    ).toBe('windows');
    expect(resolveServerIcon({ name: 'Miku', host: { platform: 'linux' } })).toBe('miku');
    expect(resolveServerIcon({ name: 'Miku', host: { platform: 'linux' } }, 'nas')).toBe('nas');
  });

  it('orders hierarchical disks, computes partition layout vs filesystem space, and avoids double-counting', () => {
    const disks: ServerDiskRecord[] = [
      {
        id: 'part2',
        name: 'Root',
        type: 'partition',
        parentId: 'nvme0',
        mountpoint: '/',
        filesystem: 'ext4',
        totalBytes: 900,
        usedBytes: 300,
        availableBytes: 550,
      },
      {
        id: 'nvme0',
        name: 'NVMe SSD',
        type: 'disk',
        physical: true,
        parentId: null,
        mountpoint: null,
        filesystem: null,
        totalBytes: 1000,
        usedBytes: null,
        availableBytes: null,
      },
      {
        id: 'part1',
        name: 'EFI',
        type: 'partition',
        partitionRole: 'efi',
        parentId: 'nvme0',
        mountpoint: '/boot/efi',
        filesystem: 'vfat',
        totalBytes: 50,
        usedBytes: 10,
        availableBytes: 40,
      },
    ];

    const ordered = orderServerDisks(disks);
    expect(ordered.map((d) => d.id)).toEqual(['nvme0', 'part2', 'part1']);
    expect(serverDiskDepth(ordered[1]!, ordered)).toBe(1);

    const rootSpace = computeServerDiskSpace(ordered[0]!, ordered);
    expect(rootSpace.title).toBe('Partition layout');
    expect(rootSpace.proportional).toBe(true);
    expect(rootSpace.segments.map((s) => [s.id, s.bytes, s.targetId])).toEqual([
      ['part2', 900, 'part2'],
      ['part1', 50, 'part1'],
      ['unreported', 50, undefined],
    ]);

    const partSpace = computeServerDiskSpace(ordered[1]!, ordered);
    expect(partSpace.title).toBe('Space usage');
    expect(partSpace.segments.map((s) => [s.id, s.bytes])).toEqual([
      ['used', 300],
      ['other', 50],
      ['available', 550],
    ]);

    const summary = summarizeServerDisks(disks);
    expect(summary.totalBytes).toBe(1000);
    expect(summary.deviceCount).toBe(1);
    expect(summary.largestMounted?.id).toBe('part2');
  });
});
