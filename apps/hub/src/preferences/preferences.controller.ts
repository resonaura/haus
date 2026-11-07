/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Controller,
  Get,
  Patch,
  Body,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { PatchPreferencesDto, PreferencesResponseDto } from './preferences.dto.js';

export const PREFERENCES_SERVICE = 'PREFERENCES_SERVICE';

export interface IPreferencesService {
  get(): Promise<PreferencesResponseDto>;
  patch(
    baseRevision: string,
    patch: Record<string, unknown>,
  ): Promise<PreferencesResponseDto & { conflict?: boolean }>;
}

@ApiTags('Preferences')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/preferences')
export class PreferencesController {
  constructor(
    @Optional()
    @Inject(PREFERENCES_SERVICE)
    private readonly preferencesService?: IPreferencesService,
  ) {}

  private requireService(): IPreferencesService {
    if (!this.preferencesService) {
      throw new HttpException(
        { error: 'preferences_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.preferencesService;
  }

  @ApiOperation({ summary: 'Get current household and UI preferences' })
  @ApiResponse({ status: 200, description: 'Preferences state', type: PreferencesResponseDto })
  @Get()
  async get(): Promise<PreferencesResponseDto> {
    const service = this.requireService();
    return service.get();
  }

  @ApiOperation({ summary: 'Atomically patch household and UI preferences' })
  @ApiResponse({
    status: 200,
    description: 'Preferences updated successfully',
    type: PreferencesResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid preference keys or payload too large' })
  @ApiResponse({ status: 409, description: 'Revision conflict' })
  @Patch()
  async patch(@Body() body: PatchPreferencesDto): Promise<PreferencesResponseDto> {
    const service = this.requireService();
    try {
      const result = await service.patch(body.baseRevision, body.patch);
      if (result.conflict) {
        throw new HttpException(result, HttpStatus.CONFLICT);
      }
      return result;
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : 'invalid_shared_config';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }
}
