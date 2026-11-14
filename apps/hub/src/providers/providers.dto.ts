/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class ConnectProviderDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Provider bridge UUID',
  })
  @IsString()
  bridgeId!: string;
}

export class EnrollProviderDto {
  @ApiProperty({ example: 'http://192.168.1.40:8580', description: 'Bridge base URL' })
  @IsString()
  url!: string;

  @ApiProperty({ example: 'a'.repeat(48), description: 'One-time bridge pairing code' })
  @IsString()
  code!: string;

  @ApiProperty({ example: true, description: 'Allow a local HTTP bridge endpoint' })
  @IsBoolean()
  allowHttp!: boolean;
}

export class ImportCamerasDto {
  @ApiProperty({
    example: ['camera.front_door', 'camera.backyard'],
    description: 'List of camera entity IDs to import',
  })
  @IsArray()
  cameras!: string[];
}

export class ProviderBridgeItemDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Provider bridge UUID',
  })
  id!: string;

  @ApiProperty({ example: 'aqara', description: 'Vendor provider kind' })
  provider!: string;

  @ApiProperty({ example: 'http://192.168.1.40:8580', description: 'Bridge address' })
  url!: string;

  @ApiProperty({ example: true, description: 'Whether the bridge was recently reachable' })
  available!: boolean;

  @ApiProperty({ example: 2, description: 'Number of cameras exposed by the bridge' })
  cameras!: number;
}

export class ProvidersListResponseDto {
  @ApiProperty({ type: [ProviderBridgeItemDto], description: 'Registered vendor bridge providers' })
  providers!: ProviderBridgeItemDto[];
}

export class TuyaQrStartDto {
  @ApiPropertyOptional({
    example: 'us',
    enum: ['eu', 'we', 'us', 'ue', 'cn', 'in'],
    description: 'Optional Tuya data-center region',
  })
  @IsOptional()
  @IsIn(['eu', 'we', 'us', 'ue', 'cn', 'in'])
  region?: string;
}
