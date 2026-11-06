/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IClusterService } from './cluster.controller.js';
import type {
  AddNodeDto,
  UpdateNodeDto,
  ClusterNodeRecordDto,
  ClusterStatusResponseDto,
} from './cluster.dto.js';

export interface ClusterDatabaseHandle {
  exec(sql: string): void;
  prepare(sql: string): {
    all(): Array<{ id: string; value: string }>;
    run(...args: unknown[]): unknown;
  };
}

@Injectable()
export class DefaultClusterService implements IClusterService {
  private readonly nodesMap = new Map<string, ClusterNodeRecordDto>();
  private db?: ClusterDatabaseHandle;
  private readonly coordinatorId = `hub-${randomUUID().slice(0, 8)}`;

  bindDatabase(db: ClusterDatabaseHandle): void {
    this.db = db;
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS cluster_nodes(id TEXT PRIMARY KEY, value TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS cluster_locations(digest TEXT NOT NULL, node_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(digest, node_id));
       CREATE TABLE IF NOT EXISTS cluster_media(event_id TEXT PRIMARY KEY, digest TEXT NOT NULL, bytes INTEGER NOT NULL, version INTEGER NOT NULL);`,
    );
    const rows = this.db.prepare('SELECT id, value FROM cluster_nodes').all();
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value) as ClusterNodeRecordDto;
        this.nodesMap.set(row.id, { ...parsed, id: row.id });
      } catch {}
    }
  }

  status(): ClusterStatusResponseDto {
    return {
      id: this.coordinatorId,
      role: 'coordinator',
      nodes: Array.from(this.nodesMap.values()),
    };
  }

  async add(node: AddNodeDto): Promise<ClusterNodeRecordDto> {
    if (!node.url || typeof node.url !== 'string') {
      throw new HttpException({ error: 'invalid_node_url' }, HttpStatus.BAD_REQUEST);
    }

    const id = randomUUID();
    const record: ClusterNodeRecordDto = {
      id,
      name: node.name ?? `Node ${id.slice(0, 6)}`,
      url: node.url,
      enabled: true,
      roles: node.roles ?? ['storage', 'stream'],
      online: true,
    };

    if (this.db) {
      this.db
        .prepare('INSERT INTO cluster_nodes(id, value) VALUES(?, ?)')
        .run(id, JSON.stringify(record));
    }

    this.nodesMap.set(id, record);
    return record;
  }

  async update(id: string, patch: UpdateNodeDto): Promise<ClusterNodeRecordDto> {
    const existing = this.nodesMap.get(id);
    if (!existing) {
      throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
    }

    const updated: ClusterNodeRecordDto = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.roles !== undefined ? { roles: patch.roles } : {}),
    };

    if (this.db) {
      this.db
        .prepare('UPDATE cluster_nodes SET value = ? WHERE id = ?')
        .run(JSON.stringify(updated), id);
    }

    this.nodesMap.set(id, updated);
    return updated;
  }

  remove(id: string): { removed: boolean; id: string } {
    const existing = this.nodesMap.get(id);
    if (!existing) {
      throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
    }

    if (this.db) {
      this.db.prepare('DELETE FROM cluster_nodes WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM cluster_locations WHERE node_id = ?').run(id);
    }

    this.nodesMap.delete(id);
    return { removed: true, id };
  }
}
