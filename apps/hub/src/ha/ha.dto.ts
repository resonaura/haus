/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class HaIntegrationSetupDto {
  @ApiPropertyOptional({
    example: 'http://192.168.4.44:8123',
    description: 'Home Assistant core instance URL',
  })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ description: 'Authentication token or credentials' })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({ example: 'setup', description: 'Action to perform: setup or revoke' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Whether native entities are requested' })
  @IsOptional()
  @IsBoolean()
  nativeEntities?: boolean;

  @ApiPropertyOptional({ description: 'Client ID to revoke if action is revoke' })
  @IsOptional()
  @IsString()
  clientId?: string;
}

export class HaEnrollDto {
  @ApiPropertyOptional({ example: 'client-uuid-12345', description: 'HA camera client identifier' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Enrollment options and capabilities' })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Setup code generated during integration setup' })
  @IsOptional()
  @IsString()
  code?: string;
}

export class HaCameraItemDto {
  @ApiProperty({ example: 'camera.living_room', description: 'Camera entity ID' })
  entityId!: string;

  @ApiProperty({ example: 'Living Room Camera', description: 'Camera display name' })
  name!: string;

  @ApiProperty({ example: true, description: 'Whether camera is online' })
  online!: boolean;
}

export class HaCamerasListResponseDto {
  @ApiProperty({ example: 1, description: 'Protocol profile version' })
  profile!: number;

  @ApiProperty({ example: { disabledReadiness: true }, description: 'Supported native features' })
  nativeFeatures!: Record<string, boolean>;

  @ApiProperty({ type: [HaCameraItemDto], description: 'Exposed cameras' })
  cameras!: HaCameraItemDto[];
}
