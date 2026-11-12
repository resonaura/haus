/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  HaCameraItemDto,
  HaCamerasListResponseDto,
  HaEnrollDto,
  HaIntegrationSetupDto,
} from './ha.dto.js';

export const HA_CAMERAS_SERVICE = 'HA_CAMERAS_SERVICE';

export interface IHaCamerasService {
  setup(input: HaIntegrationSetupDto): Promise<unknown> | unknown;
  enroll(input: unknown): Promise<unknown> | unknown;
  revoke(clientId: string): Promise<unknown> | unknown;
  authenticate(
    authHeader?: string,
    context?: { method?: string; url?: string },
  ): string | undefined;
  canManageNative?(clientId: string): boolean;
  cameras(): HaCameraItemDto[];
  snapshot(
    id: string,
    clientId?: string,
  ): Promise<{ buffer: Buffer; mime: string; at: number; stale: boolean }>;
  command(clientId: string, camera: string, action: string, payload: unknown): Promise<unknown>;
  nativeDevices(): unknown[];
  nativeCommand(camera: string, entity: string, payload: unknown): Promise<unknown>;
  nativeAcknowledge(clientId: string, payload: unknown): unknown;
}

@ApiTags('Home Assistant Integration')
@Controller()
export class HaController {
  constructor(
    @Optional()
    @Inject(HA_CAMERAS_SERVICE)
    private readonly haService?: IHaCamerasService,
  ) {}

  private requireService(): IHaCamerasService {
    if (!this.haService) {
      throw new HttpException({ error: 'ha_service_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.haService;
  }

  private requireClient(authHeader?: string, context?: { method?: string; url?: string }): string {
    const service = this.requireService();
    const clientId = service.authenticate(authHeader, context);
    if (!clientId) {
      throw new HttpException({ error: 'camera_access_required' }, HttpStatus.UNAUTHORIZED);
    }
    return clientId;
  }

  private requireNativeClient(
    authHeader?: string,
    context?: { method?: string; url?: string },
  ): string {
    const clientId = this.requireClient(authHeader, context);
    const service = this.requireService();
    if (service.canManageNative && !service.canManageNative(clientId)) {
      throw new HttpException({ error: 'native_access_required' }, HttpStatus.FORBIDDEN);
    }
    return clientId;
  }

  private handleError(err: unknown): never {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'camera_access_required') {
      throw new HttpException({ error: msg }, HttpStatus.UNAUTHORIZED);
    }
    if (msg === 'native_access_required' || msg === 'native_ha_grant_revoked') {
      throw new HttpException({ error: msg }, HttpStatus.FORBIDDEN);
    }
    if (
      msg === 'camera_not_found' ||
      msg === 'camera_session_not_found' ||
      msg === 'native_camera_not_found' ||
      msg === 'native_entity_not_found'
    ) {
      throw new HttpException({ error: msg }, HttpStatus.NOT_FOUND);
    }
    if (
      msg === 'camera_viewer_busy' ||
      msg === 'camera_viewer_unavailable' ||
      msg === 'camera_snapshot_unavailable' ||
      msg === 'ha_integration_busy'
    ) {
      throw new HttpException({ error: msg }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (
      msg === 'invalid_ha_integration' ||
      msg === 'invalid_ha_setup_code' ||
      msg === 'invalid_camera_viewer' ||
      msg === 'invalid_camera_action' ||
      msg === 'native_command_rejected' ||
      msg === 'invalid_native_readiness' ||
      msg === 'invalid_native_entity_command'
    ) {
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
    if (err instanceof HttpException) throw err;
    throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
  }

  @ApiOperation({ summary: 'Setup Home Assistant compatibility integration' })
  @ApiBearerAuth('bearer')
  @UseGuards(AuthGuard)
  @ApiResponse({ status: 200, description: 'HA integration setup result' })
  @HttpCode(200)
  @Post('api/ha-integration')
  async setup(@Body() body: HaIntegrationSetupDto): Promise<unknown> {
    const service = this.requireService();
    try {
      return await service.setup(body);
    } catch (err) {
      this.handleError(err);
    }
  }

  @ApiOperation({ summary: 'Enroll Home Assistant camera client session' })
  @ApiResponse({ status: 200, description: 'Client enrolled' })
  @HttpCode(200)
  @Post('ha/enroll')
  async enroll(@Body() body: HaEnrollDto): Promise<unknown> {
    const service = this.requireService();
    try {
      return await service.enroll(body);
    } catch (err) {
      this.handleError(err);
    }
  }

  @ApiOperation({ summary: 'Revoke Home Assistant camera client session' })
  @ApiResponse({ status: 200, description: 'Client revoked' })
  @HttpCode(200)
  @Post('ha/revoke')
  async revoke(@Headers('authorization') authHeader?: string): Promise<unknown> {
    const clientId = this.requireClient(authHeader, { method: 'POST', url: '/ha/revoke' });
    const service = this.requireService();
    try {
      return await service.revoke(clientId);
    } catch (err) {
      this.handleError(err);
    }
  }

  @ApiOperation({ summary: 'List exposed Home Assistant camera entities' })
  @ApiResponse({ status: 200, description: 'Exposed cameras list', type: HaCamerasListResponseDto })
  @Get('ha/cameras')
  getCameras(@Headers('authorization') authHeader?: string): HaCamerasListResponseDto {
    this.requireClient(authHeader, { method: 'GET', url: '/ha/cameras' });
    const service = this.requireService();
    return {
      profile: 1,
      nativeFeatures: { disabledReadiness: true },
      cameras: service.cameras(),
    };
  }

  @ApiOperation({ summary: 'Capture live camera snapshot JPEG' })
  @ApiParam({ name: 'id', description: 'Camera entity ID' })
  @ApiResponse({ status: 200, description: 'Snapshot image bytes' })
  @Get('ha/cameras/:id/snapshot')
  async getSnapshot(
    @Param('id') id: string,
    @Headers('authorization') authHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const clientId = this.requireClient(authHeader, {
      method: 'GET',
      url: `/ha/cameras/${id}/snapshot`,
    });
    const service = this.requireService();
    try {
      const result = await service.snapshot(id, clientId);
      res.writeHead(HttpStatus.OK, {
        'Content-Type': result.mime,
        'Cache-Control': 'no-store',
        'X-Haus-Snapshot-Captured-At': String(result.at),
        'X-Haus-Snapshot-Stale': result.stale ? '1' : '0',
      });
      res.end(result.buffer);
    } catch (err) {
      this.handleError(err);
    }
  }

  @ApiOperation({
    summary: 'Dispatch camera viewer session command (viewer, candidate, close, lease)',
  })
  @ApiParam({ name: 'id', description: 'Camera entity ID' })
  @ApiParam({ name: 'action', description: 'Action kind' })
  @ApiResponse({ status: 200, description: 'Command execution result' })
  @HttpCode(200)
  @Post('ha/cameras/:id/:action')
  async cameraCommand(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authHeader?: string,
  ): Promise<unknown> {
    const clientId = this.requireClient(authHeader, {
      method: 'POST',
      url: `/ha/cameras/${id}/${action}`,
    });
    const service = this.requireService();
    try {
      return await service.command(clientId, id, action, body);
    } catch (err) {
      this.handleError(err);
    }
  }

  @ApiOperation({ summary: 'List Home Assistant native devices' })
  @ApiResponse({ status: 200, description: 'Native devices' })
  @Get('ha/native/devices')
  getNativeDevices(@Headers('authorization') authHeader?: string): { devices: unknown[] } {
    this.requireNativeClient(authHeader, { method: 'GET', url: '/ha/native/devices' });
    const service = this.requireService();
    return { devices: service.nativeDevices() };
  }

  @ApiOperation({ summary: 'Acknowledge native entities readiness' })
  @ApiResponse({ status: 200, description: 'Readiness acknowledged' })
  @HttpCode(200)
  @Post('ha/native/ready')
  async nativeReady(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authHeader?: string,
  ): Promise<unknown> {
    const clientId = this.requireNativeClient(authHeader, {
      method: 'POST',
      url: '/ha/native/ready',
    });
    const service = this.requireService();
    try {
      return await service.nativeAcknowledge(clientId, body);
    } catch (err) {
      this.handleError(err);
    }
  }

  @ApiOperation({ summary: 'Dispatch command to native entity' })
  @ApiParam({ name: 'camera', description: 'Camera entity ID' })
  @ApiParam({ name: 'entity', description: 'Sub-entity identifier' })
  @ApiResponse({ status: 200, description: 'Command dispatched' })
  @HttpCode(200)
  @Post('ha/native/:camera/:entity/command')
  async nativeCommand(
    @Param('camera') camera: string,
    @Param('entity') entity: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authHeader?: string,
  ): Promise<unknown> {
    this.requireNativeClient(authHeader, {
      method: 'POST',
      url: `/ha/native/${camera}/${entity}/command`,
    });
    const service = this.requireService();
    try {
      return await service.nativeCommand(camera, entity, body);
    } catch (err) {
      this.handleError(err);
    }
  }
}
