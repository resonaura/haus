/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CreateBackupDto, BackupsListResponseDto, RecoveryKitResponseDto } from './backups.dto.js';

export const BACKUPS_SERVICE = 'BACKUPS_SERVICE';

export interface IBackupsService {
  list(): BackupsListResponseDto['items'];
  busy: boolean;
  error: string | null;
  canSnapshot?(kind: string): boolean;
  snapshot(kind: 'haus' | 'ha'): Promise<void>;
  recoveryKit(): Record<string, unknown>;
}

@ApiTags('Backups')
@ApiBearerAuth('bearer')
@Controller('api/backups')
export class BackupsController {
  constructor(
    @Optional()
    @Inject(BACKUPS_SERVICE)
    private readonly backupsService?: IBackupsService,
  ) {}

  private requireService(): IBackupsService {
    if (!this.backupsService) {
      throw new HttpException(
        { error: 'backups_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.backupsService;
  }

  @ApiOperation({ summary: 'List available backup archives and current backup status' })
  @ApiResponse({
    status: 200,
    description: 'List of backup archives',
    type: BackupsListResponseDto,
  })
  @Get()
  list(): BackupsListResponseDto {
    const service = this.requireService();
    return {
      items: service.list(),
      busy: service.busy,
      error: service.error,
    };
  }

  @ApiOperation({ summary: 'Trigger a hot backup snapshot' })
  @ApiResponse({ status: 202, description: 'Backup snapshot initiated' })
  @ApiResponse({ status: 400, description: 'Invalid backup kind' })
  @ApiResponse({ status: 409, description: 'Backup is currently busy or unavailable' })
  @HttpCode(202)
  @Post('create')
  async create(@Body() body: CreateBackupDto): Promise<{ started: boolean }> {
    const service = this.requireService();
    const canRun = service.canSnapshot ? service.canSnapshot(body.kind) : !service.busy;
    if (!canRun) {
      throw new HttpException({ error: 'backup_busy' }, HttpStatus.CONFLICT);
    }
    void service.snapshot(body.kind).catch(() => {});
    return { started: true };
  }

  @ApiOperation({ summary: 'Retrieve recovery kit and cluster nodes for emergency restore' })
  @ApiResponse({
    status: 200,
    description: 'Recovery kit credentials and metadata',
    type: RecoveryKitResponseDto,
  })
  @HttpCode(200)
  @Post('recovery')
  recovery(): RecoveryKitResponseDto {
    const service = this.requireService();
    const kit = service.recoveryKit();
    return {
      recoveryKey: String(kit.recoveryKey ?? ''),
      nodes: Array.isArray(kit.nodes) ? (kit.nodes as Array<Record<string, unknown>>) : [],
    };
  }
}
