/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthResponseDto } from './health.dto.js';

export const HAUS_RUNTIME_MODE = 'HAUS_RUNTIME_MODE';

@ApiTags('System')
@Controller()
export class HealthController {
  constructor(
    @Optional()
    @Inject(HAUS_RUNTIME_MODE)
    private readonly runtimeMode?: string,
  ) {}

  @ApiOperation({ summary: 'Liveness probe and system health' })
  @ApiResponse({
    status: 200,
    description: 'System is healthy and responding to requests',
    type: HealthResponseDto,
  })
  @Get('health')
  getHealth(): HealthResponseDto {
    const mode = this.runtimeMode === 'ha-appliance' ? 'ha-appliance' : 'standalone';
    return {
      status: 'ok',
      mode,
      ha: mode === 'ha-appliance',
      timestamp: Date.now(),
    };
  }

  @ApiOperation({ summary: 'API health status' })
  @ApiResponse({
    status: 200,
    description: 'API subsystem health status',
    type: HealthResponseDto,
  })
  @Get('api/health')
  getApiHealth(): HealthResponseDto {
    return this.getHealth();
  }
}
