/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { ClientSession } from '@haus/core/auth';
import type { TerminalTicketResponse } from '@haus/core/protocol';
import { AuthGuard } from '../auth/auth.guard.js';
import { UpdateStoragePolicyDto, ServersStatusResponseDto } from './servers.dto.js';
import { HubTerminalService } from './terminal/service.js';

export const SERVERS_SERVICE = 'SERVERS_SERVICE';

export interface IServersService {
  status(): Promise<ServersStatusResponseDto>;
  update(patch: { storageLimitBytes: number | null }): Promise<void> | void;
}

@ApiTags('Servers')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/servers')
export class ServersController {
  constructor(
    @Optional()
    @Inject(SERVERS_SERVICE)
    private readonly serversService?: IServersService,
    @Optional()
    @Inject(HubTerminalService)
    private readonly terminalService?: HubTerminalService,
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

  @ApiOperation({
    summary: 'Issue a short-lived E2EE handshake ticket for Haus Secure Terminal IPC',
  })
  @ApiResponse({ status: 200, description: 'Signed X25519 terminal handshake ticket' })
  @ApiResponse({ status: 403, description: 'Admin session required or peer untrusted' })
  @Post('terminal/ticket')
  @HttpCode(200)
  async issueTerminalTicket(
    @Req() req: FastifyRequest & { session?: ClientSession },
    @Body() body: Record<string, unknown>,
  ): Promise<TerminalTicketResponse> {
    if (!this.terminalService) {
      throw new HttpException({ error: 'terminal_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.terminalService.issueClientTicket(req.session, body);
  }
}
