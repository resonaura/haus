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
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { BrandIconHint } from '@haus/core/brands';
import {
  isIconAppearance,
  resolveIconTintColor,
  type IconAppearance,
  type ResolvedIconVariation,
} from '@haus/icons';
import type { IconRenderServiceStatus } from '@haus/icons/node';
import { AuthGuard } from '../auth/auth.guard.js';
import { BrandsService } from './brands.service.js';

function sanitizeHintParam(value: unknown, maxLen = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return undefined;
  return trimmed;
}

function parseStyleParams(
  appearanceRaw?: string,
  variationRaw?: string,
  tintRaw?: string,
  sizeRaw?: string,
): {
  readonly appearance: IconAppearance;
  readonly variation: ResolvedIconVariation;
  readonly tintHex: string;
  readonly displaySize: number;
} | null {
  if (!appearanceRaw || !isIconAppearance(appearanceRaw)) return null;
  const variation: ResolvedIconVariation = variationRaw === 'dark' ? 'dark' : 'light';
  const tintHex = resolveIconTintColor(tintRaw ?? 'automatic');
  const parsedSize = Number(sizeRaw);
  const displaySize =
    Number.isFinite(parsedSize) && parsedSize >= 16 && parsedSize <= 256
      ? Math.round(parsedSize)
      : 44;
  return { appearance: appearanceRaw, variation, tintHex, displaySize };
}

export interface BrandIconApiResponse {
  readonly dataUri: string | null;
  readonly rendered?: boolean;
  readonly layout?: 'fill' | 'inset';
  readonly revision?: string;
  readonly engine?: 'cpp' | 'ts' | 'passthrough';
}

@Controller('api/brands')
@UseGuards(AuthGuard)
export class BrandsController {
  constructor(
    @Inject(BrandsService)
    private readonly brands: BrandsService,
  ) {}

  @Get('status')
  getStatus(): IconRenderServiceStatus {
    return this.brands.getStatus();
  }

  @Post('prewarm')
  @HttpCode(200)
  async triggerPrewarm(): Promise<{ queued: number; total: number }> {
    return this.brands.startBackgroundWarmup();
  }

  @Get('icon')
  async getIconByQuery(
    @Query('kind') kind?: string,
    @Query('id') id?: string,
    @Query('dark') dark?: string,
    @Query('appearance') appearance?: string,
    @Query('variation') variation?: string,
    @Query('tint') tint?: string,
    @Query('size') size?: string,
    @Query('name') name?: string,
    @Query('supportedBy') supportedBy?: string,
    @Query('repositoryUrl') repositoryUrl?: string,
    @Query('repository') repository?: string,
    @Query('category') category?: string,
    @Query('addonSlug') addonSlug?: string,
    @Query('addonConfigPath') addonConfigPath?: string,
  ): Promise<BrandIconApiResponse> {
    return this.resolveResponse(
      kind,
      id,
      dark,
      {
        name: sanitizeHintParam(name, 120),
        supportedBy: sanitizeHintParam(supportedBy, 100),
        repositoryUrl: sanitizeHintParam(repositoryUrl, 240),
        repository: sanitizeHintParam(repository, 160),
        category: sanitizeHintParam(category, 64),
        addonSlug: sanitizeHintParam(addonSlug, 120),
        addonConfigPath: sanitizeHintParam(addonConfigPath, 160),
      },
      parseStyleParams(appearance, variation, tint, size),
    );
  }

  @Get(':kind/:id')
  async getIconByParam(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query('dark') dark?: string,
    @Query('appearance') appearance?: string,
    @Query('variation') variation?: string,
    @Query('tint') tint?: string,
    @Query('size') size?: string,
    @Query('name') name?: string,
    @Query('supportedBy') supportedBy?: string,
    @Query('repositoryUrl') repositoryUrl?: string,
    @Query('repository') repository?: string,
    @Query('category') category?: string,
    @Query('addonSlug') addonSlug?: string,
    @Query('addonConfigPath') addonConfigPath?: string,
  ): Promise<BrandIconApiResponse> {
    return this.resolveResponse(
      kind,
      id,
      dark,
      {
        name: sanitizeHintParam(name, 120),
        supportedBy: sanitizeHintParam(supportedBy, 100),
        repositoryUrl: sanitizeHintParam(repositoryUrl, 240),
        repository: sanitizeHintParam(repository, 160),
        category: sanitizeHintParam(category, 64),
        addonSlug: sanitizeHintParam(addonSlug, 120),
        addonConfigPath: sanitizeHintParam(addonConfigPath, 160),
      },
      parseStyleParams(appearance, variation, tint, size),
    );
  }

  private async resolveResponse(
    kind: string | undefined,
    id: string | undefined,
    dark: string | undefined,
    hint: BrandIconHint,
    style: ReturnType<typeof parseStyleParams>,
  ): Promise<BrandIconApiResponse> {
    try {
      if (style) {
        const result = await this.brands.resolveRendered({
          kind: kind ?? '',
          id: id ?? '',
          dark: dark === '1' || dark === 'true',
          hint,
          appearance: style.appearance,
          variation: style.variation,
          tintHex: style.tintHex,
          displaySize: style.displaySize,
        });
        return {
          dataUri: result.dataUri,
          rendered: result.rendered,
          layout: result.layout,
          revision: result.revision,
          engine: result.engine,
        };
      }
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
