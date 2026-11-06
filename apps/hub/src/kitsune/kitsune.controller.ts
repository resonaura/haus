/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Controller,
  Get,
  Post,
  All,
  Param,
  Body,
  Req,
  Res,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  KitsuneOnboardDto,
  KitsuneCreateDeviceDto,
  KitsuneCatalogResponseDto,
} from './kitsune.dto.js';

export const KITSUNE_SERVICE = 'KITSUNE_SERVICE';

export interface WebhookResult {
  code: number;
  headers: Record<string, string>;
  body: string | Buffer;
}

export interface IKitsuneService {
  catalog(): KitsuneCatalogResponseDto['vendors'];
  onboard(vendor: string, fields: Record<string, string>): Promise<unknown>;
  create(vendor: string, settings: Record<string, unknown>): Promise<unknown>;
  enable(vendor: string): Promise<Record<string, unknown>>;
  settings(vendor: string): Promise<unknown>;
  canWebhook(plugin: string, token: string): boolean;
  webhook(
    plugin: string,
    subpath: string | undefined,
    request: { method: string; url: string; headers: Record<string, string>; body: string },
    token: string,
  ): Promise<WebhookResult>;
}

@ApiTags('Kitsune Plugins')
@Controller('api/kitsune')
export class KitsuneController {
  constructor(
    @Optional()
    @Inject(KITSUNE_SERVICE)
    private readonly kitsuneService?: IKitsuneService,
  ) {}

  private requireService(): IKitsuneService {
    if (!this.kitsuneService) {
      throw new HttpException(
        { error: 'kitsune_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.kitsuneService;
  }

  @ApiOperation({ summary: 'Get available and installed Kitsune plugin vendors catalog' })
  @ApiResponse({ status: 200, description: 'Plugin catalog', type: KitsuneCatalogResponseDto })
  @Get('catalog')
  catalog(): KitsuneCatalogResponseDto {
    const service = this.requireService();
    return { vendors: service.catalog() };
  }

  @ApiOperation({ summary: 'Onboard a vendor bridge plugin with cloud or local credentials' })
  @ApiParam({ name: 'vendor', description: 'Vendor identifier (e.g. tuya, eufy)' })
  @ApiResponse({ status: 200, description: 'Vendor onboarding successful' })
  @Post(':vendor/onboard')
  async onboard(
    @Param('vendor') vendor: string,
    @Body() body: KitsuneOnboardDto,
  ): Promise<{ created: unknown }> {
    const service = this.requireService();
    try {
      const result = await service.onboard(vendor, body.fields);
      return { created: result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'onboard_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Create a new vendor device instance' })
  @ApiParam({ name: 'vendor', description: 'Vendor identifier' })
  @ApiResponse({ status: 200, description: 'Device created' })
  @Post(':vendor/create')
  async create(
    @Param('vendor') vendor: string,
    @Body() body: KitsuneCreateDeviceDto,
  ): Promise<{ created: unknown }> {
    const service = this.requireService();
    try {
      const result = await service.create(vendor, body.settings);
      return { created: result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'create_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Enable vendor bridge runtime' })
  @ApiParam({ name: 'vendor', description: 'Vendor identifier' })
  @ApiResponse({ status: 200, description: 'Plugin enabled' })
  @Post(':vendor/enable')
  async enable(@Param('vendor') vendor: string): Promise<Record<string, unknown>> {
    const service = this.requireService();
    try {
      return await service.enable(vendor);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'enable_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Get vendor device creation settings schema' })
  @ApiParam({ name: 'vendor', description: 'Vendor identifier' })
  @ApiResponse({ status: 200, description: 'Settings schema' })
  @Post(':vendor/settings')
  async getSettings(@Param('vendor') vendor: string): Promise<{ settings: unknown }> {
    const service = this.requireService();
    try {
      const result = await service.settings(vendor);
      return { settings: result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'settings_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Dynamic webhook ingress dispatch for vendor event hooks' })
  @All('hooks/:token/:plugin/{*path}')
  async handleWebhook(
    @Param('token') token: string,
    @Param('plugin') plugin: string,
    @Param('path') pathParam: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const service = this.requireService();
    if (!service.canWebhook(plugin, token)) {
      res.status(HttpStatus.UNAUTHORIZED).json({ error: 'webhook_authentication_required' });
      return;
    }

    const subpath = Array.isArray(pathParam)
      ? pathParam.join('/')
      : typeof pathParam === 'string' && pathParam.length > 0
        ? pathParam
        : undefined;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }

    const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const result = await service.webhook(
      plugin,
      subpath,
      {
        method: req.method,
        url: req.url,
        headers,
        body: bodyStr,
      },
      token,
    );

    res.writeHead(result.code, result.headers);
    res.end(result.body);
  }
}
