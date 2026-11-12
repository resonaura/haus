/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { MatterService } from '../matter/service.js';
import { HomeKitControllerService } from './service.js';

export interface PairHomeKitDto {
  accessoryId?: string;
  pin: string;
  address?: string;
  port?: number;
  name?: string;
}

@ApiTags('Discovery & Pairing')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api')
export class HomeKitDiscoveryController {
  constructor(
    private readonly homekitService: HomeKitControllerService,
    @Optional()
    @Inject(MatterService)
    private readonly matterService?: MatterService,
  ) {}

  @Get('discovery/homekit')
  @ApiOperation({ summary: 'Discover HomeKit accessories on LAN via mDNS' })
  async discoverHomeKit(@Query('timeoutMs') timeoutMs?: string) {
    const parsedTimeout = timeoutMs ? parseInt(timeoutMs, 10) : 2500;
    const discovered = await this.homekitService.discoverAccessories(
      Number.isFinite(parsedTimeout) ? Math.min(10000, Math.max(500, parsedTimeout)) : 2500,
    );
    return {
      discovered,
      pairings: this.homekitService.listPairings(),
    };
  }

  @Post('discovery/homekit/pair')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pair a HomeKit accessory or bridge with its 8-digit setup code' })
  async pairHomeKit(@Body() body: PairHomeKitDto) {
    if (!body?.pin) {
      throw new BadRequestException({ error: 'invalid_homekit_pair_payload' });
    }
    try {
      const result = await this.homekitService.pairAccessory(body);
      return {
        status: 'paired',
        pairing: {
          accessoryId: result.pairing.accessoryId,
          name: result.pairing.name,
          address: result.pairing.address,
          port: result.pairing.port,
        },
        devices: result.devices,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'homekit_pairing_failed';
      throw new BadRequestException({ error: msg });
    }
  }

  @Delete('discovery/homekit/:accessoryId')
  @ApiOperation({ summary: 'Unpair a HomeKit accessory/bridge and remove its devices' })
  async unpairHomeKit(@Param('accessoryId') accessoryId: string) {
    const result = await this.homekitService.unpairAccessory(accessoryId);
    return { status: 'unpaired', accessoryId, ...result };
  }

  @Delete('matter/nodes/:nodeId')
  @ApiOperation({ summary: 'Remove a Matter node and its bridged devices from Haus Hub' })
  async removeMatterNode(@Param('nodeId') nodeId: string) {
    if (!this.matterService?.isConfigured) {
      throw new BadRequestException({ error: 'matter_service_unavailable' });
    }
    const result = await this.matterService.removeNode(nodeId);
    return { status: 'removed', nodeId, ...result };
  }
}
