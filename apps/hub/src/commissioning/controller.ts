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
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CommissioningService } from './service.js';

@ApiTags('Commissioning')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/commissioning')
export class CommissioningController {
  constructor(private readonly service: CommissioningService) {}

  @Post('sessions')
  @HttpCode(202)
  @ApiOperation({ summary: 'Start code-first onboarding (Matter / HomeKit / Improv)' })
  create(@Body() body: { code?: string }) {
    if (typeof body?.code !== 'string' || !body.code.trim()) {
      throw new BadRequestException({ error: 'setup_code_required' });
    }
    try {
      return this.service.create(body.code);
    } catch (err: unknown) {
      throw new BadRequestException({
        error: err instanceof Error ? err.message : 'invalid_setup_code',
      });
    }
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get commissioning transaction state and events' })
  get(@Param('id') id: string) {
    const tx = this.service.get(id);
    if (!tx) throw new NotFoundException({ error: 'commissioning_not_found' });
    return tx;
  }

  @Post('sessions/:id/credentials')
  @HttpCode(202)
  @ApiOperation({ summary: 'Provide Wi-Fi credentials when network.credentials.required' })
  credentials(@Param('id') id: string, @Body() body: { ssid?: string; password?: string }) {
    if (!body?.ssid || typeof body.password !== 'string') {
      throw new BadRequestException({ error: 'wifi_credentials_required' });
    }
    const tx = this.service.provideCredentials(id, { ssid: body.ssid, password: body.password });
    if (!tx) throw new NotFoundException({ error: 'commissioning_not_found' });
    return tx;
  }
}
