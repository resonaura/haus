/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { statfs } from 'node:fs/promises';
import { arch, cpus, freemem, hostname, loadavg, platform, totalmem } from 'node:os';
import { CLUSTER_SERVICE, type IClusterService } from '../cluster/cluster.controller.js';
import { HUB_DATA_DIRECTORY } from '../cluster/crypto/master-key.js';
import type { IServersService } from './servers.controller.js';
import type { ServersStatusResponseDto, ServerItemDto } from './servers.dto.js';

@Injectable()
export class DefaultServersService implements IServersService {
  private storageLimitBytes: number | null = null;

  constructor(
    @Optional() @Inject(CLUSTER_SERVICE) private readonly clusterService?: IClusterService,
    @Optional() @Inject(HUB_DATA_DIRECTORY) private readonly dataDir?: string,
  ) {}

  async status(): Promise<ServersStatusResponseDto> {
    const now = Date.now();
    const memTotal = totalmem();
    const memFree = freemem();
    const memUsed = Math.max(0, memTotal - memFree);
    const cpuCount = Math.max(1, cpus().length);
    const load1m = loadavg()[0] ?? 0;
    const cpuPercent = Math.min(100, Math.round((load1m / cpuCount) * 1000) / 10);

    let diskTotalBytes: number | null = null;
    let diskFreeBytes: number | null = null;
    let diskUsedBytes = 0;
    try {
      const targetDir = this.dataDir?.trim() || process.env.HAUS_DATA?.trim() || process.cwd();
      const fs = await statfs(targetDir);
      diskTotalBytes = Number(fs.blocks) * Number(fs.bsize);
      diskFreeBytes = Number(fs.bavail) * Number(fs.bsize);
      diskUsedBytes = Math.max(0, diskTotalBytes - diskFreeBytes);
    } catch {
      // Fall back to null filesystem totals on unsupported platforms.
    }

    const cluster = this.clusterService?.status();
    const localId = cluster?.id ?? 'local-hub';
    const localRole = cluster?.role ?? 'coordinator';
    const localNodeRecord = cluster?.nodes.find((node) => node.id === localId);
    const localRoles = Array.from(
      new Set([localRole, ...(localNodeRecord?.roles ?? ['storage', 'stream'])]),
    );
    const availableBytes =
      this.storageLimitBytes === null
        ? diskFreeBytes
        : Math.max(
            0,
            diskFreeBytes === null
              ? this.storageLimitBytes - diskUsedBytes
              : Math.min(diskFreeBytes, this.storageLimitBytes - diskUsedBytes),
          );

    const hubServer: ServerItemDto = {
      id: localId,
      kind: 'hub',
      name: localNodeRecord?.name ?? `Haus Hub (${hostname()})`,
      enabled: localNodeRecord?.enabled ?? true,
      roles: localRoles,
      online: true,
      lastSeen: now,
      storage: {
        usedBytes: diskUsedBytes,
        totalBytes: diskTotalBytes,
        freeBytes: diskFreeBytes,
        availableBytes,
        limitBytes: this.storageLimitBytes,
        storageLimitBytes: this.storageLimitBytes,
      },
      host: {
        hostname: hostname(),
        platform: platform(),
        arch: arch(),
        cpuCores: cpuCount,
        load1m: Math.round(load1m * 100) / 100,
        cpuPercent,
        memoryUsedBytes: memUsed,
        memoryFreeBytes: memFree,
        memoryTotalBytes: memTotal,
      },
      settings: { storageLimitBytes: this.storageLimitBytes },
    };

    const peerServers: ServerItemDto[] = (cluster?.nodes ?? [])
      .filter((node) => node.id !== localId)
      .map((node) => ({
        id: node.id,
        kind: 'hub',
        name: node.name,
        enabled: node.enabled,
        roles: [...node.roles],
        online: Boolean(node.online),
        lastSeen: node.lastSeen ?? now,
        ...(node.url ? { url: node.url } : {}),
        ...(typeof node.livePriority === 'number' ? { livePriority: node.livePriority } : {}),
        ...(node.sshServerId ? { sshServerId: node.sshServerId } : {}),
        settings: {
          storageLimitBytes: node.storageLimitBytes ?? null,
        },
      }));

    return {
      features: { monitoringOnlyServers: true },
      servers: [hubServer, ...peerServers],
      sampledAt: now,
    };
  }

  update(patch: { storageLimitBytes: number | null }): void {
    if (patch.storageLimitBytes !== undefined) {
      this.storageLimitBytes = patch.storageLimitBytes;
    }
  }
}
