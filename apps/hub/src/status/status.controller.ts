/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Controller, Get, HttpException, HttpStatus, Inject, Optional } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HubStatusResponseDto } from './status.dto.js';

export const STATUS_SERVICE = 'STATUS_SERVICE';

export interface IStatusService {
  status(): Promise<HubStatusResponseDto> | HubStatusResponseDto;
}

@ApiTags('System')
@Controller('api/status')
export class StatusController {
  constructor(
    @Optional()
    @Inject(STATUS_SERVICE)
    private readonly statusService?: IStatusService,
  ) {}

  private requireService(): IStatusService {
    if (!this.statusService) {
      throw new HttpException(
        { error: 'status_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.statusService;
  }

  @ApiOperation({ summary: 'Get Haus Hub runtime status and system capabilities' })
  @ApiResponse({ status: 200, description: 'Runtime status response', type: HubStatusResponseDto })
  @Get()
  async status(): Promise<HubStatusResponseDto> {
    const service = this.requireService();
    return service.status();
  }
}
