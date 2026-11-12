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
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  VendorCommissioningService,
  type ClassifyCandidateDto,
  type ProvisionVendorDto,
} from './vendor.service.js';

@ApiTags('Commissioning')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/commissioning/vendor')
export class VendorCommissioningController {
  constructor(private readonly vendorService: VendorCommissioningService) {}

  @Post('classify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Classify vendor candidate device protocols from discovery metadata' })
  classify(@Body() body: ClassifyCandidateDto) {
    if (!body || !body.host) {
      throw new BadRequestException({ error: 'host_required' });
    }
    return this.vendorService.classify(body);
  }

  @Post('provision')
  @HttpCode(200)
  @ApiOperation({ summary: 'Provision Wi-Fi credentials to a vendor SoftAP/RPC device' })
  async provision(@Body() body: ProvisionVendorDto) {
    if (!body || !body.candidate || !body.ssid) {
      throw new BadRequestException({ error: 'candidate_and_ssid_required' });
    }
    return this.vendorService.provision(body);
  }
}
