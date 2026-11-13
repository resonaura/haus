/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CAMERA_SERVICE } from './tokens.js';
import type { CameraService } from './types.js';
import {
  CameraAccessBootstrapDto,
  CameraOperatingDto,
  CameraSpotlightDto,
  CameraUpdateDto,
  CameraViewerCloseDto,
  CameraViewerDto,
  CameraWarmDto,
  HomeKitSettingsDto,
} from './camera.dto.js';

@ApiTags('Cameras')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller()
export class CamerasController {
  constructor(
    @Inject(CAMERA_SERVICE) private readonly cameraService: CameraService,
    @Optional()
    @Inject('LIVE_SERVICE')
    private readonly liveService?: { publish(topic: string): void },
  ) {}

  @Get('api/cameras')
  @ApiOperation({ summary: 'List all registered cameras with operating and telemetry status' })
  async listCameras() {
    const cameras = await this.cameraService.listCameras();
    return { cameras };
  }

  @Get('api/detectors')
  @ApiOperation({ summary: 'List all registered hardware and software detection sensors' })
  async listDetectors() {
    const detectors = await this.cameraService.listDetectors();
    return { detectors };
  }

  @Post('api/camera-access')
  @HttpCode(200)
  @ApiOperation({ summary: 'Bootstrap cryptographic access token for direct camera streaming' })
  async bootstrapAccess(@Body() body: CameraAccessBootstrapDto) {
    try {
      return await this.cameraService.bootstrapAccess(body.cameraId, body.clientId);
    } catch (err) {
      this.handleError(err);
    }
  }

  @Get('api/cameras/:id/snapshot')
  @ApiOperation({ summary: 'Retrieve latest cached or real-time camera snapshot' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async getSnapshot(@Param('id') id: string, @Res() res: Response) {
    try {
      const snapshot = await this.cameraService.getSnapshot(id);
      res.setHeader('Content-Type', snapshot.mime);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Haus-Snapshot-Stale', snapshot.stale ? '1' : '0');
      res.setHeader('X-Haus-Snapshot-Captured-At', String(snapshot.at));
      return res.status(200).send(snapshot.buffer);
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/talk')
  @ApiOperation({ summary: 'Stream two-way talkback audio to the camera' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async talkback(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    try {
      if (!this.cameraService.talkbackStream) {
        throw new ServiceUnavailableException({ error: 'talkback_unavailable' });
      }
      await this.cameraService.talkbackStream(id, req, res);
    } catch (err: unknown) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      this.handleError(err);
    }
  }

  @Patch('api/cameras/:id')
  @ApiOperation({ summary: 'Update camera settings, enablement, talkback, and sensors' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async updateCamera(@Param('id') id: string, @Body() body: CameraUpdateDto) {
    try {
      const camera = await this.cameraService.updateCamera(id, body as Record<string, unknown>);
      this.liveService?.publish('cameras');
      return { camera };
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/operating')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set hardware indicator LED or night-vision operating state' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async setOperating(@Param('id') id: string, @Body() body: CameraOperatingDto) {
    try {
      const result = await this.cameraService.setOperating(
        id,
        body.control,
        body.entityId,
        body.value,
      );
      this.liveService?.publish('cameras');
      return result;
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/spotlight')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a supported camera spotlight state or color' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async setSpotlight(@Param('id') id: string, @Body() body: CameraSpotlightDto) {
    try {
      const { entityId, ...value } = body;
      const result = await this.cameraService.setSpotlight(id, entityId, value);
      this.liveService?.publish('cameras');
      return result;
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/viewer')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create or update WebRTC viewer session offer' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async viewer(@Param('id') id: string, @Body() body: CameraViewerDto) {
    try {
      return await this.cameraService.viewerOffer(id, body.owner, body.viewerId, body.offer);
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/viewer/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close active WebRTC viewer session' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async closeViewer(@Param('id') id: string, @Body() body: CameraViewerCloseDto) {
    try {
      return await this.cameraService.closeViewer(id, body.owner, body.viewerId);
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/warm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Touch warm live streaming session' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async touchWarm(@Param('id') id: string, @Body() body: CameraWarmDto) {
    try {
      return await this.cameraService.touchWarm(id, body.owner, body.active, body.preview);
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/record')
  @HttpCode(201)
  @ApiOperation({ summary: 'Trigger manual camera recording session' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async triggerRecording(@Param('id') id: string) {
    try {
      return await this.cameraService.triggerRecording(id);
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/homekit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update HomeKit Secure Video accessory settings' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async updateHomeKit(@Param('id') id: string, @Body() body: HomeKitSettingsDto) {
    try {
      const result = await this.cameraService.updateHomeKitSettings(id, body);
      this.liveService?.publish('cameras');
      return result;
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/homekit/pair')
  @HttpCode(200)
  @ApiOperation({ summary: 'Generate or retrieve HomeKit pairing setup payload' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async homekitPair(@Param('id') id: string) {
    try {
      return await this.cameraService.getHomeKitPairing(id);
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/homekit/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close active HomeKit pairing session' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async homekitClose(@Param('id') id: string) {
    try {
      const result = await this.cameraService.manageHomeKitPairing(id, 'close');
      this.liveService?.publish('cameras');
      return result;
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  @Post('api/cameras/:id/homekit/reset')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset HomeKit pairing configuration and keys' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async homekitReset(@Param('id') id: string) {
    try {
      const result = await this.cameraService.manageHomeKitPairing(id, 'reset');
      this.liveService?.publish('cameras');
      return result;
    } catch (err: unknown) {
      this.handleError(err);
    }
  }

  private handleError(err: unknown): never {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'camera_not_found' || message === 'camera_viewer_not_found') {
      throw new NotFoundException({ error: message });
    }
    if (message === 'snapshot_unavailable') {
      throw new ServiceUnavailableException({ error: 'snapshot_unavailable' });
    }
    if (
      message === 'invalid_camera_control' ||
      message === 'invalid_spotlight_command' ||
      message === 'invalid_warm_session' ||
      message === 'invalid_camera_viewer' ||
      message === 'invalid_camera_candidate' ||
      message === 'invalid_enabled' ||
      message === 'invalid_detectors' ||
      message === 'invalid_sensors' ||
      message === 'invalid_storage_pool' ||
      message === 'invalid_talkback_source' ||
      message === 'invalid_audio' ||
      message === 'invalid_private_talkback_address' ||
      message === 'invalid_homekit_processor' ||
      message === 'recording_disabled'
    ) {
      throw new BadRequestException({ error: message });
    }
    if (
      message === 'talkback_busy' ||
      message === 'snapshot_busy' ||
      message === 'camera_control_busy' ||
      message === 'camera_control_unconfirmed' ||
      message === 'camera_control_unavailable' ||
      message === 'camera_viewer_busy' ||
      message === 'camera_viewer_closed' ||
      message === 'camera_viewer_exists' ||
      message === 'recording_storage_limit' ||
      message === 'spotlight_unavailable'
    ) {
      throw new ConflictException({ error: message });
    }
    if (
      message === 'talkback_unavailable' ||
      message === 'talkback_cancelled' ||
      message === 'recording_worker_unavailable' ||
      message === 'camera_unavailable' ||
      message === 'camera_session_unavailable' ||
      message === 'camera_nvr_required' ||
      message === 'camera_nvr_session_unavailable'
    ) {
      throw new ServiceUnavailableException({ error: message });
    }
    throw new ServiceUnavailableException({ error: message });
  }
}
