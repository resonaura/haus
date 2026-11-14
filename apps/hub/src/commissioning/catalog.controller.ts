/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CommissioningService } from './service.js';

@ApiTags('Integration Catalog')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/catalog')
export class CatalogController {
  constructor(private readonly commissioning: CommissioningService) {}

  @Get('integrations')
  @ApiOperation({ summary: 'Get Home Assistant integration catalog' })
  @ApiResponse({ status: 200, description: 'Catalog integrations list' })
  getCatalogIntegrations() {
    const catalog = this.commissioning.catalog.getCatalog();
    return {
      version: catalog.getVersion(),
      total: catalog.getTotalCount(),
      domains: catalog.getAllDomains(),
      integrations: catalog.getAllManifests(),
    };
  }

  @Get('version')
  @ApiOperation({ summary: 'Check upstream Home Assistant release version' })
  @ApiResponse({ status: 200, description: 'Version status' })
  async getCatalogVersion() {
    return await this.commissioning.catalog.checkUpstreamVersion();
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh catalog from upstream' })
  @ApiResponse({ status: 200, description: 'Refreshed catalog details' })
  async refreshCatalog() {
    const updated = await this.commissioning.refreshCatalog();
    return {
      version: updated.getVersion(),
      total: updated.getTotalCount(),
      sha256: updated.getSha256(),
    };
  }
}
