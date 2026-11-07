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
  authenticate(authHeader?: string): string | undefined;
  cameras(): HaCameraItemDto[];
  snapshot(id: string): Promise<{ buffer: Buffer; mime: string; at: number; stale: boolean }>;
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

  private requireClient(authHeader?: string): string {
    const service = this.requireService();
    const clientId = service.authenticate(authHeader);
    if (!clientId) {
      throw new HttpException({ error: 'camera_access_required' }, HttpStatus.UNAUTHORIZED);
    }
    return clientId;
  }

  @ApiOperation({ summary: 'Setup Home Assistant compatibility integration' })
  @ApiBearerAuth('bearer')
  @UseGuards(AuthGuard)
  @ApiResponse({ status: 200, description: 'HA integration setup result' })
  @HttpCode(200)
  @Post('api/ha-integration')
  async setup(@Body() body: HaIntegrationSetupDto): Promise<unknown> {
    const service = this.requireService();
    return service.setup(body);
  }

  @ApiOperation({ summary: 'Enroll Home Assistant camera client session' })
  @ApiResponse({ status: 200, description: 'Client enrolled' })
  @HttpCode(200)
  @Post('ha/enroll')
  async enroll(@Body() body: HaEnrollDto): Promise<unknown> {
    const service = this.requireService();
    return service.enroll(body);
  }

  @ApiOperation({ summary: 'Revoke Home Assistant camera client session' })
  @ApiResponse({ status: 200, description: 'Client revoked' })
  @HttpCode(200)
  @Post('ha/revoke')
  async revoke(@Headers('authorization') authHeader?: string): Promise<unknown> {
    const clientId = this.requireClient(authHeader);
    const service = this.requireService();
    return service.revoke(clientId);
  }

  @ApiOperation({ summary: 'List exposed Home Assistant camera entities' })
  @ApiResponse({ status: 200, description: 'Exposed cameras list', type: HaCamerasListResponseDto })
  @Get('ha/cameras')
  getCameras(@Headers('authorization') authHeader?: string): HaCamerasListResponseDto {
    this.requireClient(authHeader);
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
    this.requireClient(authHeader);
    const service = this.requireService();
    const result = await service.snapshot(id);
    res.writeHead(HttpStatus.OK, {
      'Content-Type': result.mime,
      'Cache-Control': 'no-store',
      'X-Haus-Snapshot-Captured-At': String(result.at),
      'X-Haus-Snapshot-Stale': result.stale ? '1' : '0',
    });
    res.end(result.buffer);
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
    const clientId = this.requireClient(authHeader);
    const service = this.requireService();
    return service.command(clientId, id, action, body);
  }

  @ApiOperation({ summary: 'List Home Assistant native devices' })
  @ApiResponse({ status: 200, description: 'Native devices' })
  @Get('ha/native/devices')
  getNativeDevices(@Headers('authorization') authHeader?: string): { devices: unknown[] } {
    this.requireClient(authHeader);
    const service = this.requireService();
    return { devices: service.nativeDevices() };
  }

  @ApiOperation({ summary: 'Acknowledge native entities readiness' })
  @ApiResponse({ status: 200, description: 'Readiness acknowledged' })
  @HttpCode(200)
  @Post('ha/native/ready')
  nativeReady(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authHeader?: string,
  ): unknown {
    const clientId = this.requireClient(authHeader);
    const service = this.requireService();
    return service.nativeAcknowledge(clientId, body);
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
    this.requireClient(authHeader);
    const service = this.requireService();
    return service.nativeCommand(camera, entity, body);
  }
}
