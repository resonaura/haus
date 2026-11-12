/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { HomeKitPublicationService } from './publication.service.js';

export interface AddBridgeDeviceDto {
  deviceId: string;
}

export interface SelectBridgeDevicesDto {
  deviceIds: string[];
}

export interface ReauthorizeControllersDto {
  allowedControllerIds: string[];
}

export interface PublishStandaloneCameraDto {
  port?: number;
}

@ApiTags('Apple Home Publishing')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/homekit/publication')
export class HomeKitPublicationController {
  constructor(private readonly publicationService: HomeKitPublicationService) {}

  @Get('bridge')
  @ApiOperation({ summary: 'Get Haus HAP bridge publication and pairing status' })
  getBridge() {
    return {
      bridge: this.publicationService.getBridgeSetup(),
      devices: this.publicationService.getBridgedDevices(),
    };
  }

  @Post('bridge/devices')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add a device to the Haus HAP bridge' })
  async addBridgeDevice(@Body() body: AddBridgeDeviceDto) {
    if (!body?.deviceId) {
      throw new BadRequestException({ error: 'missing_device_id' });
    }
    try {
      const summary = await this.publicationService.addDeviceToBridge(body.deviceId);
      return { status: 'bridged', summary };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'failed_to_bridge_device';
      throw new BadRequestException({ error: msg });
    }
  }

  @Delete('bridge/devices/:deviceId')
  @ApiOperation({ summary: 'Remove a device from the Haus HAP bridge' })
  async removeBridgeDevice(@Param('deviceId') deviceId: string) {
    const removed = await this.publicationService.removeDeviceFromBridge(deviceId);
    return { removed, deviceId };
  }

  @Post('bridge/select')
  @HttpCode(200)
  @ApiOperation({ summary: 'Audit and select devices for the Haus HAP bridge' })
  async selectBridgeDevices(@Body() body: SelectBridgeDevicesDto) {
    if (!Array.isArray(body?.deviceIds)) {
      throw new BadRequestException({ error: 'invalid_device_ids_array' });
    }
    const report = await this.publicationService.selectBridgeDevices(body.deviceIds);
    return { report, devices: this.publicationService.getBridgedDevices() };
  }

  @Post('bridge/reset')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset bridge pairing credentials and set discoverable' })
  async resetBridge() {
    const bridge = await this.publicationService.resetBridgePairing();
    return { status: 'reset', bridge };
  }

  @Post('bridge/reauthorize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reauthorize controllers and revoke stale pairings' })
  async reauthorizeBridge(@Body() body: ReauthorizeControllersDto) {
    if (!Array.isArray(body?.allowedControllerIds)) {
      throw new BadRequestException({ error: 'invalid_allowed_controller_ids' });
    }
    const bridge = await this.publicationService.reauthorizeBridge(body.allowedControllerIds);
    return { status: 'reauthorized', bridge };
  }

  @Get('accessories')
  @ApiOperation({ summary: 'List all published accessories (bridge and standalone)' })
  listAccessories() {
    return { accessories: this.publicationService.listPublishedAccessories() };
  }

  @Get('devices/:deviceId/mapping')
  @ApiOperation({
    summary: 'Inspect device HAP service/characteristic mapping and unsupported capabilities',
  })
  async getDeviceMapping(@Param('deviceId') deviceId: string) {
    try {
      const mapping = await this.publicationService.getDeviceMapping(deviceId);
      return { mapping };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'device_mapping_failed';
      throw new NotFoundException({ error: msg });
    }
  }

  @Post('standalone/:deviceId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish camera as a standalone HAP accessory' })
  async publishStandaloneCamera(
    @Param('deviceId') deviceId: string,
    @Body() body: PublishStandaloneCameraDto,
  ) {
    try {
      const identity = await this.publicationService.publishStandaloneCamera(deviceId, body?.port);
      const setup = this.publicationService.getStandaloneSetupData(deviceId);
      return { status: 'published', identity, setup };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'standalone_publish_failed';
      throw new BadRequestException({ error: msg });
    }
  }

  @Delete('standalone/:id')
  @ApiOperation({ summary: 'Unpublish standalone accessory' })
  async unpublishStandalone(@Param('id') id: string) {
    const unpublished = await this.publicationService.unpublishStandalone(id);
    return { unpublished, id };
  }

  @Post('standalone/:id/reset')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset standalone accessory pairing and cycle credentials' })
  async resetStandalone(@Param('id') id: string) {
    try {
      const setup = await this.publicationService.resetStandalonePairing(id);
      return { status: 'reset', setup };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'standalone_reset_failed';
      throw new BadRequestException({ error: msg });
    }
  }

  @Post('standalone/:id/reauthorize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reauthorize controllers for standalone accessory' })
  async reauthorizeStandalone(@Param('id') id: string, @Body() body: ReauthorizeControllersDto) {
    if (!Array.isArray(body?.allowedControllerIds)) {
      throw new BadRequestException({ error: 'invalid_allowed_controller_ids' });
    }
    try {
      const identity = await this.publicationService.reauthorizeStandalone(
        id,
        body.allowedControllerIds,
      );
      return { status: 'reauthorized', identity };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'standalone_reauthorize_failed';
      throw new BadRequestException({ error: msg });
    }
  }
}
