/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', description: 'System health indicator' })
  @IsString()
  status!: string;

  @ApiProperty({ example: 'standalone', description: 'Hub operational mode', required: false })
  @IsOptional()
  @IsString()
  mode?: string;

  @ApiProperty({ example: false, description: 'Whether Home Assistant connection is active', required: false })
  @IsOptional()
  @IsBoolean()
  ha?: boolean;

  @ApiProperty({ example: '0.3.76', description: 'Hub version', required: false })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiProperty({ example: 1730812800000, description: 'Timestamp of the health check', required: false })
  @IsOptional()
  timestamp?: number;
}
