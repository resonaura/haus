/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { BrandIconHint } from '@haus/ha/native/brand-icons';
import { AuthGuard } from '../auth/auth.guard.js';
import { BrandsService } from './brands.service.js';

function sanitizeHintParam(value: unknown, maxLen = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return undefined;
  return trimmed;
}

@Controller('api/brands')
@UseGuards(AuthGuard)
export class BrandsController {
  constructor(
    @Inject(BrandsService)
    private readonly brands: BrandsService,
  ) {}

  @Get('icon')
  async getIconByQuery(
    @Query('kind') kind?: string,
    @Query('id') id?: string,
    @Query('dark') dark?: string,
    @Query('name') name?: string,
    @Query('supportedBy') supportedBy?: string,
    @Query('repositoryUrl') repositoryUrl?: string,
    @Query('category') category?: string,
    @Query('addonSlug') addonSlug?: string,
  ): Promise<{ dataUri: string | null }> {
    return this.resolveResponse(kind, id, dark, {
      name: sanitizeHintParam(name, 120),
      supportedBy: sanitizeHintParam(supportedBy, 100),
      repositoryUrl: sanitizeHintParam(repositoryUrl, 240),
      category: sanitizeHintParam(category, 64),
      addonSlug: sanitizeHintParam(addonSlug, 120),
    });
  }

  @Get(':kind/:id')
  async getIconByParam(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query('dark') dark?: string,
    @Query('name') name?: string,
    @Query('supportedBy') supportedBy?: string,
    @Query('repositoryUrl') repositoryUrl?: string,
    @Query('category') category?: string,
    @Query('addonSlug') addonSlug?: string,
  ): Promise<{ dataUri: string | null }> {
    return this.resolveResponse(kind, id, dark, {
      name: sanitizeHintParam(name, 120),
      supportedBy: sanitizeHintParam(supportedBy, 100),
      repositoryUrl: sanitizeHintParam(repositoryUrl, 240),
      category: sanitizeHintParam(category, 64),
      addonSlug: sanitizeHintParam(addonSlug, 120),
    });
  }

  private async resolveResponse(
    kind: string | undefined,
    id: string | undefined,
    dark: string | undefined,
    hint: BrandIconHint,
  ): Promise<{ dataUri: string | null }> {
    try {
      const dataUri = await this.brands.resolve({
        kind: kind ?? '',
        id: id ?? '',
        dark: dark === '1' || dark === 'true',
        hint,
      });
      return { dataUri };
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid brand icon.') {
        throw new BadRequestException('Invalid brand icon.');
      }
      throw error;
    }
  }
}
