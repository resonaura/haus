/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { CATALOG_SOURCE, CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import { ClusterLocationEntity, ClusterNodeEntity } from '../storage/entities/domains.js';
import type { Transactions } from '../storage/transactions.js';
import type { IClusterService } from './cluster.controller.js';
import type {
  AddNodeDto,
  UpdateNodeDto,
  ClusterNodeRecordDto,
  ClusterStatusResponseDto,
} from './cluster.dto.js';

@Injectable()
export class DefaultClusterService implements IClusterService, OnModuleInit {
  private readonly nodesMap = new Map<string, ClusterNodeRecordDto>();
  private readonly coordinatorId = `hub-${randomUUID().slice(0, 8)}`;
  private initialization?: Promise<void>;

  constructor(
    @Optional()
    @Inject(CATALOG_SOURCE)
    private readonly source?: DataSource,
    @Optional()
    @Inject(CATALOG_TRANSACTIONS)
    private readonly transactions?: Transactions,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
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
    await this.initialize();
    const id = randomUUID();
    const record: ClusterNodeRecordDto = {
      id,
      name: node.name ?? `Node ${id.slice(0, 6)}`,
      url: node.url,
      enabled: true,
      roles: node.roles ?? ['storage', 'stream'],
      online: true,
    };
    if (this.transactions) {
      await this.transactions.run((manager) =>
        manager.insert(ClusterNodeEntity, { id, value: JSON.stringify(record) }),
      );
    }
    this.nodesMap.set(id, record);
    return record;
  }

  async update(id: string, patch: UpdateNodeDto): Promise<ClusterNodeRecordDto> {
    await this.initialize();
    const cached = this.nodesMap.get(id);
    if (!cached) throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);

    let updated = this.updateRecord(cached, patch);
    if (this.transactions) {
      updated = await this.transactions.run(async (manager) => {
        const saved = await manager.findOneBy(ClusterNodeEntity, { id });
        if (!saved) throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
        const current = JSON.parse(saved.value) as ClusterNodeRecordDto;
        const next = this.updateRecord({ ...current, id }, patch);
        await manager.update(ClusterNodeEntity, { id }, { value: JSON.stringify(next) });
        return next;
      });
    }
    this.nodesMap.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<{ removed: boolean; id: string }> {
    await this.initialize();
    if (!this.nodesMap.has(id)) {
      throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
    }
    if (this.transactions) {
      await this.transactions.run(async (manager) => {
        await manager.delete(ClusterNodeEntity, { id });
        await manager.delete(ClusterLocationEntity, { nodeId: id });
      });
    }
    this.nodesMap.delete(id);
    return { removed: true, id };
  }

  private initialize(): Promise<void> {
    const source = this.source;
    if (!source) return Promise.resolve();
    this.initialization ??= (async () => {
      const rows = await source.manager.find(ClusterNodeEntity);
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.value) as ClusterNodeRecordDto;
          this.nodesMap.set(row.id, { ...parsed, id: row.id });
        } catch (error) {
          process.emitWarning(error instanceof Error ? error : String(error));
        }
      }
    })();
    return this.initialization;
  }

  private updateRecord(current: ClusterNodeRecordDto, patch: UpdateNodeDto): ClusterNodeRecordDto {
    return {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.roles !== undefined ? { roles: patch.roles } : {}),
    };
  }
}
