/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { StatsService } from './stats.service.js';
import {
  QueryStatsDto,
  HistoryStatsDto,
  MetaStatsQueryDto,
  SummaryStatsQueryDto,
} from './stats.dto.js';

@ApiTags('Statistics')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard)
@Controller('api/stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('query')
  @ApiOperation({
    summary: 'Query statistics timeseries with adaptive LTTB downsampling',
    description:
      'Retrieves telemetry samples with automatic tiered resolution selection (raw, 5m, 1h) and LTTB downsampling to match target viewport resolution.',
  })
  @ApiResponse({ status: 200, description: 'Downsampled statistics timeseries series result' })
  @ApiResponse({ status: 404, description: 'Statistic identifier not found' })
  public async query(@Query() query: QueryStatsDto) {
    return this.statsService.query(query);
  }

  @Get('history')
  @ApiOperation({
    summary: 'Query multi-series statistics history across several identifiers',
    description: 'Retrieves aligned downsampled timeseries for multiple statistic identifiers.',
  })
  @ApiResponse({ status: 200, description: 'Multi-series downsampled history' })
  public async history(@Query() query: HistoryStatsDto) {
    return this.statsService.history(query);
  }

  @Get('meta')
  @ApiOperation({
    summary: 'List available statistic metadata and unit definitions',
    description: 'Returns registered statistics metadata with optional source domain filtering.',
  })
  @ApiResponse({ status: 200, description: 'Array of statistic metadata definitions' })
  public async getMetadata(@Query() query: MetaStatsQueryDto) {
    return this.statsService.getMetadata(query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get 24-hour summary and current telemetry value',
    description: 'Returns the latest live value, 24-hour min, max, mean, and net sum.',
  })
  @ApiResponse({ status: 200, description: '24-hour statistical summary' })
  @ApiResponse({ status: 404, description: 'Statistic identifier not found' })
  public async summary(@Query() query: SummaryStatsQueryDto) {
    return this.statsService.summary(query.statistic_id);
  }
}
