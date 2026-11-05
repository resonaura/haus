/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { sanitizeStorageMedia } from './storage.js';
import { sanitizeHardware } from './hardware.js';
import { sanitizeStorageBacking } from './wsl.js';

export function stripControl(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) >= 32) result += value[i];
  }
  return result;
}

export const clean = (value: unknown, length = 240) =>
  typeof value === 'string' ? stripControl(value).slice(0, length) : '';

export const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export const unavailable = (name: string) => ({
  available: false,
  source: 'unavailable',
  [name]: [],
});

export function sanitizeHostReport(
  input: Record<string, unknown> | null | undefined,
  now = Date.now(),
) {
  if (!input) throw new Error('invalid_host_report');
  const sampled = Date.parse(typeof input.sampledAt === 'string' ? input.sampledAt : '');
  const scope = typeof input.scope === 'string' ? input.scope : '';
  if (
    !Number.isFinite(sampled) ||
    now - sampled > 30000 ||
    sampled - now > 5000 ||
    !['host', 'container'].includes(scope)
  )
    throw new Error('invalid_host_report');
  const cpu = (input.cpu ?? {}) as Record<string, unknown>,
    memory = (input.memory ?? {}) as Record<string, unknown>,
    swap = (input.swap ?? {}) as Record<string, unknown>;
  if (
    !count(memory.totalBytes) ||
    count(memory.usedBytes) === null ||
    count(memory.availableBytes) === null ||
    !count(cpu.logicalCores)
  )
    throw new Error('invalid_host_report');
  const service = (
    value: Record<string, unknown> | undefined,
    field: string,
    map: (row: Record<string, unknown>) => Record<string, unknown>,
    limit = 256,
  ) =>
    value?.available === true
      ? {
          available: true,
          source: 'host-collector',
          cpuPercentBasis:
            value.cpuPercentBasis === 'core' || value.cpuPercentBasis === 'host'
              ? value.cpuPercentBasis
              : null,
          [field]: (Array.isArray(value[field]) ? (value[field] as Record<string, unknown>[]) : [])
            .slice(0, limit)
            .map(map),
        }
      : unavailable(field);
  let storageBacking: ReturnType<typeof sanitizeStorageBacking> | undefined;
  try {
    storageBacking = sanitizeStorageBacking(
      input.storageBacking as Record<string, unknown> | undefined,
      now,
    );
  } catch {}
  return {
    sampledAt: new Date(sampled).toISOString(),
    scope,
    hostname: clean(input.hostname, 160),
    platform: clean(input.platform, 40),
    distribution: clean(input.distribution, 80) || null,
    osName: clean(input.osName, 160) || null,
    release: clean(input.release, 120),
    arch: clean(input.arch, 40),
    ...sanitizeHardware(input),
    ...(['wsl', 'windows'].includes(String(input.metricsScope))
      ? { metricsScope: input.metricsScope }
      : {}),
    ...(input.serviceScope === 'wsl' ? { serviceScope: 'wsl' } : {}),
    ...((input.runtime as Record<string, unknown> | undefined)?.kind === 'wsl'
      ? {
          runtime: {
            kind: 'wsl',
            platform: 'linux',
            release: clean((input.runtime as Record<string, unknown>).release, 120),
          },
        }
      : {}),
    uptimeSeconds: count(input.uptimeSeconds),
    ...(storageBacking ? { storageBacking } : {}),
    battery:
      input.battery && typeof input.battery === 'object'
        ? {
            level:
              count((input.battery as Record<string, unknown>).level) !== null &&
              Number((input.battery as Record<string, unknown>).level) <= 100
                ? ((input.battery as Record<string, unknown>).level as number)
                : null,
            ...(typeof (input.battery as Record<string, unknown>).powerConnected === 'boolean'
              ? { powerConnected: (input.battery as Record<string, unknown>).powerConnected }
              : {}),
            charging:
              typeof (input.battery as Record<string, unknown>).charging === 'boolean'
                ? ((input.battery as Record<string, unknown>).charging as boolean)
                : null,
          }
        : null,
    cpu: {
      model: clean(cpu.model),
      logicalCores: count(cpu.logicalCores),
      usage: count(cpu.usage) === null ? null : Math.min(1, Number(cpu.usage)),
      loadAverage: (Array.isArray(cpu.loadAverage) ? cpu.loadAverage : []).slice(0, 3).map(count),
    },
    memory: {
      totalBytes: memory.totalBytes as number,
      installedBytes: count(memory.installedBytes),
      availableBytes: Math.min(Number(memory.totalBytes), Number(memory.availableBytes)),
      usedBytes: Math.min(Number(memory.totalBytes), Number(memory.usedBytes)),
    },
    swap: {
      supported: swap.supported === true,
      totalBytes: count(swap.totalBytes),
      usedBytes: count(swap.usedBytes),
    },
    disks: (Array.isArray(input.disks) ? (input.disks as Record<string, unknown>[]) : [])
      .slice(0, 128)
      .filter(
        (disk): disk is Record<string, unknown> =>
          Boolean(disk) &&
          typeof disk === 'object' &&
          (disk.totalBytes === null ||
            disk.totalBytes === undefined ||
            count(disk.totalBytes) !== null),
      )
      .map((disk) => ({
        id: clean(disk.id),
        name: clean(disk.name),
        kind: disk.kind === 'disk' ? 'disk' : 'volume',
        type: ['disk', 'partition', 'container', 'volume'].includes(String(disk.type))
          ? String(disk.type)
          : disk.kind === 'disk'
            ? 'disk'
            : 'volume',
        physical: typeof disk.physical === 'boolean' ? disk.physical : null,
        parentId: typeof disk.parentId === 'string' ? clean(disk.parentId) : null,
        parentIds: (Array.isArray(disk.parentIds)
          ? disk.parentIds
          : typeof disk.parentId === 'string'
            ? [disk.parentId]
            : []
        )
          .filter((id): id is string => typeof id === 'string' && id !== disk.id)
          .slice(0, 16)
          .map((id) => clean(id)),
        mountpoint: typeof disk.mountpoint === 'string' ? clean(disk.mountpoint) : null,
        filesystem: typeof disk.filesystem === 'string' ? clean(disk.filesystem, 80) : null,
        totalBytes: count(disk.totalBytes),
        usedBytes: count(disk.usedBytes),
        availableBytes: count(disk.availableBytes),
        scope,
        ...sanitizeStorageMedia(disk),
        ...([
          'efi',
          'reserved',
          'recovery',
          'data',
          'boot',
          'system',
          'kernel',
          'boot-state',
          'overlay',
          'swap',
          'home',
          'lvm',
          'raid',
          'encrypted',
        ].includes(String(disk.partitionRole))
          ? { partitionRole: disk.partitionRole }
          : {}),
        ...(typeof disk.partitionNumber === 'number' &&
        Number.isSafeInteger(disk.partitionNumber) &&
        disk.partitionNumber > 0
          ? { partitionNumber: disk.partitionNumber }
          : {}),
        ...(typeof disk.readOnly === 'boolean' ? { readOnly: disk.readOnly } : {}),
        ...(typeof disk.device === 'string' && /^\/dev\/[a-zA-Z0-9_!+./-]{1,120}$/.test(disk.device)
          ? { device: clean(disk.device) }
          : {}),
        ...(Array.isArray(disk.mountpoints)
          ? {
              mountpoints: (disk.mountpoints as unknown[])
                .filter(
                  (value): value is string => typeof value === 'string' && value.startsWith('/'),
                )
                .slice(0, 16)
                .map((value) => clean(value)),
            }
          : {}),
      })),
    docker: service(input.docker as Record<string, unknown> | undefined, 'containers', (row) => ({
      id: clean(row.id, 80),
      name: clean(row.name, 160),
      image: clean(row.image),
      state: clean(row.state, 40),
      status: clean(row.status, 160),
      cpuPercent: count(row.cpuPercent),
      memoryUsedBytes: count(row.memoryUsedBytes),
      memoryLimitBytes: count(row.memoryLimitBytes),
    })),
    pm2: service(input.pm2 as Record<string, unknown> | undefined, 'processes', (row) => ({
      id: count(row.id),
      name: clean(row.name, 160),
      status: clean(row.status, 40),
      pid: count(row.pid),
      cpuPercent: count(row.cpuPercent),
      memoryBytes: count(row.memoryBytes),
      uptimeSeconds: count(row.uptimeSeconds),
      restarts: count(row.restarts),
    })),
    systemServices: {
      ...service(
        input.systemServices as Record<string, unknown> | undefined,
        'services',
        (row) => ({
          id: clean(row.id, 240),
          name: clean(row.name, 240),
          status: clean(row.status, 40),
          detail: clean(row.detail, 160),
          pid: count(row.pid),
          cpuPercent: count(row.cpuPercent),
          memoryBytes: count(row.memoryBytes),
          uptimeSeconds: count(row.uptimeSeconds),
          ...(row.sharedProcess === true ? { sharedProcess: true } : {}),
          ...(['windows', 'wsl'].includes(String(row.domain)) ? { domain: row.domain } : {}),
        }),
        512,
      ),
      source: ['systemd', 'windows', 'windows-wsl', 'launchd', 'launchd-user'].includes(
        String((input.systemServices as Record<string, unknown> | undefined)?.source),
      )
        ? (input.systemServices as Record<string, unknown>).source
        : 'unavailable',
      sampledAt:
        typeof (input.systemServices as Record<string, unknown> | undefined)?.sampledAt ===
          'string' &&
        Number.isFinite(
          Date.parse((input.systemServices as Record<string, unknown>).sampledAt as string),
        )
          ? new Date(
              Date.parse((input.systemServices as Record<string, unknown>).sampledAt as string),
            ).toISOString()
          : null,
      cpuPercent: count((input.systemServices as Record<string, unknown> | undefined)?.cpuPercent),
      memoryBytes: count(
        (input.systemServices as Record<string, unknown> | undefined)?.memoryBytes,
      ),
    },
  };
}
