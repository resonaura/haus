/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Controller,
  Get,
  Patch,
  Body,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UpdateStoragePolicyDto, ServersStatusResponseDto } from './servers.dto.js';

export const SERVERS_SERVICE = 'SERVERS_SERVICE';

export interface IServersService {
  status(): Promise<ServersStatusResponseDto>;
  update(patch: { storageLimitBytes: number | null }): Promise<void> | void;
}

@ApiTags('Servers')
@ApiBearerAuth('bearer')
@Controller('api/servers')
export class ServersController {
  constructor(
    @Optional()
    @Inject(SERVERS_SERVICE)
    private readonly serversService?: IServersService,
  ) {}

  private requireService(): IServersService {
    if (!this.serversService) {
      throw new HttpException(
        { error: 'servers_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.serversService;
  }

  @ApiOperation({ summary: 'Get status, telemetry, and capacity of all servers in the cluster' })
  @ApiResponse({
    status: 200,
    description: 'Cluster servers status and telemetry',
    type: ServersStatusResponseDto,
  })
  @Get()
  async status(): Promise<ServersStatusResponseDto> {
    const service = this.requireService();
    return service.status();
  }

  @ApiOperation({ summary: 'Update Home Assistant primary storage quota limit' })
  @ApiResponse({
    status: 200,
    description: 'Updated servers status',
    type: ServersStatusResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid storage limit value' })
  @Patch('home-assistant')
  async updateStoragePolicy(
    @Body() body: UpdateStoragePolicyDto,
  ): Promise<ServersStatusResponseDto> {
    const service = this.requireService();
    try {
      await service.update({ storageLimitBytes: body.storageLimitBytes });
      return await service.status();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'invalid_storage_limit';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }
}
