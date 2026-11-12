/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotImplementedException,
  Optional,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  ConnectProviderDto,
  EnrollProviderDto,
  ImportCamerasDto,
  ProviderBridgeItemDto,
  ProvidersListResponseDto,
} from './providers.dto.js';

export const PROVIDERS_SERVICE = 'PROVIDERS_SERVICE';

export interface IProvidersService {
  list(): ProviderBridgeItemDto[];
  discover(): Promise<unknown[]>;
  add(provider: EnrollProviderDto): Promise<ProviderBridgeItemDto>;
  connect(bridgeId: string): Promise<unknown>;
  preview(bridgeId: string): Promise<unknown>;
  import(bridgeId: string, cameras: string[]): Promise<unknown>;
  remove(bridgeId: string): Promise<void>;
  handover?(bridgeId?: string): Promise<unknown>;
  migrationStatus?(bridgeId: string): Promise<unknown>;
  migrationReview?(bridgeId: string): Promise<unknown>;
  migrationStart?(bridgeId: string, input: unknown, isUndo: boolean): Promise<unknown>;
}

@ApiTags('Providers')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/providers')
export class ProvidersController {
  constructor(
    @Optional()
    @Inject(PROVIDERS_SERVICE)
    private readonly providersService?: IProvidersService,
  ) {}

  private requireService(): IProvidersService {
    if (!this.providersService) {
      throw new HttpException(
        { error: 'providers_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.providersService;
  }

  @ApiOperation({ summary: 'List registered vendor bridge providers' })
  @ApiResponse({ status: 200, description: 'Registered providers', type: ProvidersListResponseDto })
  @Get()
  list(): ProvidersListResponseDto {
    const service = this.requireService();
    return { providers: service.list() };
  }

  @ApiOperation({ summary: 'Trigger automatic mDNS and UPnP bridge discovery' })
  @ApiResponse({ status: 200, description: 'Discovered provider bridges' })
  @HttpCode(200)
  @Post('discover')
  async discover(): Promise<{ providers: unknown[] }> {
    const service = this.requireService();
    const result = await service.discover();
    return { providers: result };
  }

  @ApiOperation({ summary: 'Enroll a new vendor bridge provider' })
  @ApiResponse({ status: 201, description: 'Provider enrolled', type: ProviderBridgeItemDto })
  @Post('enroll')
  async enroll(@Body() body: EnrollProviderDto): Promise<ProviderBridgeItemDto> {
    const service = this.requireService();
    try {
      return await service.add(body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'enroll_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Connect to an enrolled provider bridge' })
  @ApiResponse({ status: 201, description: 'Provider connected' })
  @Post('connect')
  async connect(@Body() body: ConnectProviderDto): Promise<unknown> {
    const service = this.requireService();
    try {
      return await service.connect(body.bridgeId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'connect_failed';
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Get overall provider handover status' })
  @ApiResponse({ status: 200, description: 'Handover status' })
  @Get('handover')
  async getHandover(): Promise<unknown> {
    const service = this.requireService();
    if (!service.handover)
      throw new NotImplementedException({ error: 'provider_handover_unavailable' });
    try {
      return await service.handover();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'provider_handover_unavailable')
        throw new NotImplementedException({ error: 'provider_handover_unavailable' });
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Preview discoverable cameras on provider bridge' })
  @ApiParam({ name: 'id', description: 'Provider bridge UUID' })
  @ApiResponse({ status: 200, description: 'Camera preview list' })
  @Get(':id')
  async preview(@Param('id') id: string): Promise<{ cameras: unknown }> {
    const service = this.requireService();
    return { cameras: await service.preview(id) };
  }

  @ApiOperation({ summary: 'Import selected cameras from provider bridge' })
  @ApiParam({ name: 'id', description: 'Provider bridge UUID' })
  @ApiResponse({ status: 200, description: 'Imported cameras' })
  @HttpCode(200)
  @Post(':id/import')
  async importCameras(
    @Param('id') id: string,
    @Body() body: ImportCamerasDto,
  ): Promise<{ cameras: unknown }> {
    const service = this.requireService();
    return { cameras: await service.import(id, body.cameras) };
  }

  @ApiOperation({ summary: 'Remove provider bridge' })
  @ApiParam({ name: 'id', description: 'Provider bridge UUID' })
  @ApiResponse({ status: 200, description: 'Provider removed' })
  @HttpCode(200)
  @Post(':id/remove')
  async remove(@Param('id') id: string): Promise<{ removed: boolean }> {
    const service = this.requireService();
    await service.remove(id);
    return { removed: true };
  }

  @ApiOperation({ summary: 'Trigger native Home Assistant handover for provider' })
  @ApiParam({ name: 'id', description: 'Provider bridge UUID' })
  @ApiResponse({ status: 200, description: 'Handover complete' })
  @HttpCode(200)
  @Post(':id/handover')
  async handoverProvider(@Param('id') id: string): Promise<unknown> {
    const service = this.requireService();
    if (!service.handover)
      throw new NotImplementedException({ error: 'provider_handover_unavailable' });
    try {
      return await service.handover(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'provider_handover_unavailable')
        throw new NotImplementedException({ error: 'provider_handover_unavailable' });
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Get native migration status for provider' })
  @ApiParam({ name: 'id', description: 'Provider bridge UUID' })
  @ApiResponse({ status: 200, description: 'Migration status' })
  @Get(':id/migration')
  async getMigrationStatus(@Param('id') id: string): Promise<unknown> {
    const service = this.requireService();
    if (!service.migrationStatus)
      throw new NotImplementedException({ error: 'provider_migration_unavailable' });
    try {
      return await service.migrationStatus(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'provider_migration_unavailable')
        throw new NotImplementedException({ error: 'provider_migration_unavailable' });
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Review native migration candidate changes' })
  @ApiParam({ name: 'id', description: 'Provider bridge UUID' })
  @ApiResponse({ status: 200, description: 'Migration review diff' })
  @HttpCode(200)
  @Post(':id/migration/review')
  async reviewMigration(@Param('id') id: string): Promise<unknown> {
    const service = this.requireService();
    if (!service.migrationReview)
      throw new NotImplementedException({ error: 'provider_migration_unavailable' });
    try {
      return await service.migrationReview(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'provider_migration_unavailable')
        throw new NotImplementedException({ error: 'provider_migration_unavailable' });
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Apply native migration changes' })
  @ApiParam({ name: 'id', description: 'Provider bridge UUID' })
  @ApiResponse({ status: 202, description: 'Migration started' })
  @HttpCode(202)
  @Post(':id/migration/apply')
  async applyMigration(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const service = this.requireService();
    if (!service.migrationStart)
      throw new NotImplementedException({ error: 'provider_migration_unavailable' });
    try {
      return await service.migrationStart(id, body, false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'provider_migration_unavailable')
        throw new NotImplementedException({ error: 'provider_migration_unavailable' });
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Undo native migration changes' })
  @ApiParam({ name: 'id', description: 'Provider bridge UUID' })
  @ApiResponse({ status: 202, description: 'Undo migration started' })
  @HttpCode(202)
  @Post(':id/migration/undo')
  async undoMigration(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const service = this.requireService();
    if (!service.migrationStart)
      throw new NotImplementedException({ error: 'provider_migration_unavailable' });
    try {
      return await service.migrationStart(id, body, true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'provider_migration_unavailable')
        throw new NotImplementedException({ error: 'provider_migration_unavailable' });
      throw new HttpException({ error: msg }, HttpStatus.BAD_REQUEST);
    }
  }
}
