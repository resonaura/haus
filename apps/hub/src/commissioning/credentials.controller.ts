/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BadRequestException,
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
import { HubNetworkCredentialService } from './credentials.service.js';

@ApiTags('Commissioning')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/commissioning/credentials')
export class CommissioningCredentialsController {
  constructor(private readonly credentialService: HubNetworkCredentialService) {}

  @Get('system-network')
  @ApiOperation({ summary: 'Get current system network SSID and permission status' })
  getSystemNetwork() {
    return this.credentialService.getSystemNetworkInfo();
  }

  @Get('wifi')
  @ApiOperation({ summary: 'List stored user-approved Wi-Fi SSIDs without secrets' })
  listWifi() {
    return { ssids: this.credentialService.listWifiSsids() };
  }

  @Delete('wifi/:ssid')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a stored Wi-Fi credential' })
  deleteWifi(@Param('ssid') ssid: string) {
    const ok = this.credentialService.removeWifi(ssid);
    if (!ok) {
      throw new NotFoundException({ error: 'credential_not_found' });
    }
    return { status: 'deleted', ssid };
  }

  @Get('thread')
  @ApiOperation({ summary: 'List stored user-approved Thread networks without secrets' })
  listThread() {
    return { networks: this.credentialService.listThreadNetworks() };
  }

  @Post('thread/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve operational Thread dataset from Haus/OTBR or system provider' })
  async resolveThread() {
    const res = await this.credentialService.resolveOperationalThreadDataset();
    if (res.status === 'unsupported' || res.status === 'keychain_error') {
      throw new BadRequestException({ error: res.status, message: res.error });
    }
    return {
      status: res.status,
      networkName: res.networkName,
      extendedPanId: res.extendedPanId,
      channel: res.channel,
      panId: res.panId,
      hasDataset: res.dataset !== undefined,
    };
  }
}
