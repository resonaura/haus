/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from './home.service.js';

function parseHistoryMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const num = Number(raw);
  if (Number.isFinite(num)) return num;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

@ApiTags('Home Domain')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api')
export class HistoryController {
  constructor(
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService: StandaloneHomeService,
  ) {}

  @Get('history')
  @ApiOperation({ summary: 'Retrieve recent state transitions for selected endpoints' })
  listEndpointHistory(
    @Query('endpoint_ids') endpointIdsRaw = '',
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
  ) {
    const endpointIds = endpointIdsRaw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const toMs = parseHistoryMs(toRaw, Date.now());
    const fromMs = parseHistoryMs(fromRaw, toMs - 86_400_000);
    return {
      history: this.homeService.getEndpointHistory(endpointIds, fromMs, toMs),
    };
  }
}
