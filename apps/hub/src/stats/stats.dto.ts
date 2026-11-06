/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { StatisticResolution, StatisticSource } from '@haus/core';

export class QueryStatsDto {
  @ApiProperty({
    description: 'Unique identifier for the statistic',
    example: 'sensor.living_room_temperature',
  })
  @IsNotEmpty()
  @IsString()
  statistic_id!: string;

  @ApiProperty({
    description: 'Start of query time window in Unix epoch seconds',
    example: 1700000000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from!: number;

  @ApiProperty({
    description: 'End of query time window in Unix epoch seconds',
    example: 1700086400,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  to!: number;

  @ApiPropertyOptional({
    description: 'Tiered resolution: raw, 5m, 1h, or auto based on range',
    enum: ['raw', '5m', '1h', 'auto'],
    default: 'auto',
  })
  @IsOptional()
  @IsIn(['raw', '5m', '1h', 'auto'])
  resolution?: StatisticResolution | 'auto';

  @ApiPropertyOptional({
    description: 'Target viewport downsampling point count (LTTB)',
    default: 500,
    minimum: 2,
    maximum: 5000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(5000)
  threshold?: number;
}

export class HistoryStatsDto {
  @ApiProperty({
    description: 'Comma-separated list of statistic identifiers',
    example: 'sensor.living_room_temp,sensor.bedroom_temp',
  })
  @IsNotEmpty()
  @IsString()
  statistic_ids!: string;

  @ApiProperty({
    description: 'Start of query time window in Unix epoch seconds',
    example: 1700000000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from!: number;

  @ApiProperty({
    description: 'End of query time window in Unix epoch seconds',
    example: 1700086400,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  to!: number;

  @ApiPropertyOptional({
    description: 'Target downsampling points per series',
    default: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(5000)
  threshold?: number;
}

export class MetaStatsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter statistics by source domain',
    enum: ['device', 'system', 'radio', 'automation', 'media', 'custom'],
  })
  @IsOptional()
  @IsIn(['device', 'system', 'radio', 'automation', 'media', 'custom'])
  source?: StatisticSource;

  @ApiPropertyOptional({
    description: 'Filter by specific statistic identifier',
  })
  @IsOptional()
  @IsString()
  statistic_id?: string;
}

export class SummaryStatsQueryDto {
  @ApiProperty({
    description: 'Statistic identifier for summary calculation',
    example: 'sensor.living_room_temperature',
  })
  @IsNotEmpty()
  @IsString()
  statistic_id!: string;
}
