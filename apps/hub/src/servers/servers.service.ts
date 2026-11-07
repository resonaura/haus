/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable } from '@nestjs/common';
import type { IServersService } from './servers.controller.js';
import type { ServersStatusResponseDto, ServerItemDto } from './servers.dto.js';

@Injectable()
export class DefaultServersService implements IServersService {
  private storageLimitBytes: number | null = null;

  async status(): Promise<ServersStatusResponseDto> {
    const hubServer: ServerItemDto = {
      id: 'local-hub',
      kind: 'hub',
      name: 'Haus Hub',
      enabled: true,
      roles: ['coordinator', 'storage', 'stream'],
      online: true,
      lastSeen: Date.now(),
      storage: {
        usedBytes: 10 * 1024 * 1024 * 1024,
        totalBytes: 64 * 1024 * 1024 * 1024,
        limitBytes: this.storageLimitBytes,
      },
      host: {
        cpuPercent: 5.2,
        memoryUsedBytes: 512 * 1024 * 1024,
        memoryTotalBytes: 4 * 1024 * 1024 * 1024,
      },
    };

    return {
      features: { monitoringOnlyServers: true },
      servers: [hubServer],
      sampledAt: Date.now(),
    };
  }

  update(patch: { storageLimitBytes: number | null }): void {
    if (patch.storageLimitBytes !== undefined) {
      this.storageLimitBytes = patch.storageLimitBytes;
    }
  }
}
