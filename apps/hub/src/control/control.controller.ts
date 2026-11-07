/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ControlService } from './service.js';
import { CONTROL_SERVICE } from './types.js';
import { ConnectIntegrationDto, DispatchCommandDto } from './control.dto.js';
import { Actor } from './actor.decorator.js';
import { ControlGuard } from './control.guard.js';
import type { Command, Json } from '@haus/core/types';

function mapErrorStatus(message: string): HttpStatus {
  switch (message) {
    case 'authentication_required':
      return HttpStatus.UNAUTHORIZED;
    case 'permission_denied':
    case 'control_permission_denied':
      return HttpStatus.FORBIDDEN;
    case 'integration_not_found':
      return HttpStatus.NOT_FOUND;
    case 'integration_not_connected':
    case 'integration_already_started':
    case 'command_idempotency_conflict':
    case 'integration_recovery_unverified':
    case 'integration_local_recovery_unavailable':
    case 'stale_provider_owner':
    case 'integration_session_changed':
      return HttpStatus.CONFLICT;
    case 'json_required':
    case 'invalid_json':
    case 'invalid_command_value':
    case 'unsupported_operation':
    case 'invalid_request_payload':
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

@ApiTags('Control')
@ApiBearerAuth('bearer')
@UseGuards(ControlGuard)
@Controller('api/control/integrations')
export class ControlController {
  constructor(
    @Optional()
    @Inject(CONTROL_SERVICE)
    private readonly controlService?: ControlService,
  ) {}

  private requireService(): ControlService {
    if (!this.controlService) {
      throw new HttpException(
        { error: 'control_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.controlService;
  }

  @ApiOperation({ summary: 'Query active integration session status' })
  @ApiParam({ name: 'id', description: 'Integration resource identifier' })
  @ApiResponse({ status: 200, description: 'Integration session state' })
  @ApiResponse({ status: 404, description: 'Integration not found or inactive' })
  @Get(':id/session')
  async getSession(@Param('id') id: string, @Actor() _actor: string) {
    const service = this.requireService();
    const session = await service.session(id);
    if (!session) {
      throw new HttpException({ error: 'session_not_found' }, HttpStatus.NOT_FOUND);
    }
    return {
      state: session.state,
      generation: session.generation,
      owner: session.owner,
    };
  }

  @ApiOperation({ summary: 'Connect and admit a provider integration' })
  @ApiParam({ name: 'id', description: 'Integration resource identifier' })
  @ApiResponse({ status: 200, description: 'Integration admitted and connected' })
  @Post(':id/connect')
  async connect(
    @Param('id') id: string,
    @Body() body: ConnectIntegrationDto,
    @Actor() actorId: string,
  ) {
    const service = this.requireService();
    try {
      await service.connect(actorId, id, body.credential);
      return { status: 'connected' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'connect_failed';
      throw new HttpException({ error: msg }, mapErrorStatus(msg));
    }
  }

  @ApiOperation({ summary: 'Resume previously verified integration' })
  @ApiParam({ name: 'id', description: 'Integration resource identifier' })
  @ApiResponse({ status: 200, description: 'Integration resumed successfully' })
  @Post(':id/resume')
  async resume(@Param('id') id: string, @Actor() actorId: string) {
    const service = this.requireService();
    try {
      const result = await service.resume(actorId, id);
      return { status: result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'resume_failed';
      throw new HttpException({ error: msg }, mapErrorStatus(msg));
    }
  }

  @ApiOperation({ summary: 'Disconnect and fence provider integration' })
  @ApiParam({ name: 'id', description: 'Integration resource identifier' })
  @ApiResponse({ status: 200, description: 'Integration cleanly closed' })
  @Post(':id/disconnect')
  async disconnect(@Param('id') id: string, @Actor() actorId: string) {
    const service = this.requireService();
    try {
      await service.disconnect(actorId, id);
      return { status: 'disconnected' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'disconnect_failed';
      throw new HttpException({ error: msg }, mapErrorStatus(msg));
    }
  }

  @ApiOperation({ summary: 'Refresh rotating credential token for integration' })
  @ApiParam({ name: 'id', description: 'Integration resource identifier' })
  @ApiResponse({ status: 200, description: 'Token refreshed' })
  @Post(':id/refresh')
  async refresh(@Param('id') id: string, @Actor() _actorId: string) {
    const service = this.requireService();
    try {
      await service.refresh(id);
      return { status: 'refreshed' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'refresh_failed';
      throw new HttpException({ error: msg }, mapErrorStatus(msg));
    }
  }

  @ApiOperation({ summary: 'Dispatch command through integration with idempotency' })
  @ApiParam({ name: 'id', description: 'Integration resource identifier' })
  @ApiResponse({ status: 200, description: 'Command receipt recorded' })
  @Post(':id/command')
  async command(
    @Param('id') id: string,
    @Body() body: DispatchCommandDto,
    @Actor() actorId: string,
  ) {
    const service = this.requireService();
    const commandIntent: Command = {
      id: body.command.id,
      endpointId: body.command.endpointId,
      capabilityId: body.command.capabilityId,
      operation: body.command.operation,
      arguments: (body.command.arguments ?? {}) as Readonly<Record<string, Json>>,
    };
    try {
      const reply = await service.execute(actorId, id, body.idempotencyKey, commandIntent);
      return { receipt: reply };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'command_failed';
      throw new HttpException({ error: msg }, mapErrorStatus(msg));
    }
  }
}
