/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class EventsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by canonical camera entity ID',
    example: 'camera.porch',
  })
  @IsOptional()
  @Matches(/^camera\.[a-z0-9_]+$/, { message: 'invalid_camera' })
  camera_id?: string;

  @ApiPropertyOptional({
    description: 'Filter events starting at or after timestamp (epoch ms)',
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'invalid_filter' })
  @Min(0, { message: 'invalid_filter' })
  from?: number;

  @ApiPropertyOptional({
    description: 'Filter events ending at or before timestamp (epoch ms)',
    example: 1700000000000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'invalid_filter' })
  @Min(0, { message: 'invalid_filter' })
  to?: number;

  @ApiPropertyOptional({ description: 'Maximum number of items to return (1-200)', example: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'invalid_filter' })
  @Min(1, { message: 'invalid_filter' })
  @Max(200, { message: 'invalid_filter' })
  limit?: number;

  @ApiPropertyOptional({
    description: 'Chronological pagination direction',
    enum: ['older', 'newer'],
    example: 'older',
  })
  @IsOptional()
  @IsIn(['older', 'newer'], { message: 'invalid_direction' })
  direction?: 'older' | 'newer';

  @ApiPropertyOptional({
    description: 'Filter by classification or trigger kind',
    enum: ['motion', 'person', 'pet', 'vehicle', 'doorbell', 'manual'],
    example: 'motion',
  })
  @IsOptional()
  @IsIn(['motion', 'person', 'pet', 'vehicle', 'doorbell', 'manual'], {
    message: 'invalid_kind',
  })
  kind?: string;

  @ApiPropertyOptional({
    description: 'Filter by recording and preparation status',
    enum: ['ready', 'failed', 'interrupted', 'recording'],
    example: 'ready',
  })
  @IsOptional()
  @IsIn(['ready', 'failed', 'interrupted', 'recording'], {
    message: 'invalid_status',
  })
  status?: string;

  @ApiPropertyOptional({ description: 'Opaque pagination cursor' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class CalendarQueryDto {
  @ApiProperty({ description: 'Camera entity ID', example: 'camera.porch' })
  @IsString({ message: 'invalid_camera' })
  @IsNotEmpty({ message: 'invalid_camera' })
  @Matches(/^camera\.[a-z0-9_]+$/, { message: 'invalid_camera' })
  camera_id!: string;

  @ApiProperty({
    description: 'Comma-separated epoch timestamps defining boundary windows',
    example: '1700000000000,1700086400000',
  })
  @IsString({ message: 'invalid_calendar' })
  @IsNotEmpty({ message: 'invalid_calendar' })
  boundaries!: string;
}
