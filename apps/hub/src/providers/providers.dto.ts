/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsObject, IsString } from 'class-validator';

export class ConnectProviderDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Provider bridge UUID',
  })
  @IsString()
  bridgeId!: string;
}

export class EnrollProviderDto {
  @ApiProperty({ example: 'eufy', description: 'Vendor provider kind' })
  @IsString()
  kind!: string;

  @ApiProperty({ example: 'Eufy HomeBase', description: 'Friendly bridge name' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Connection credentials or discovery settings' })
  @IsObject()
  config!: Record<string, unknown>;
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

  @ApiProperty({ example: 'eufy', description: 'Vendor provider kind' })
  kind!: string;

  @ApiProperty({ example: 'Eufy HomeBase', description: 'Bridge name' })
  name!: string;

  @ApiProperty({ example: true, description: 'Whether bridge is connected' })
  connected!: boolean;
}

export class ProvidersListResponseDto {
  @ApiProperty({ type: [ProviderBridgeItemDto], description: 'Registered vendor bridge providers' })
  providers!: ProviderBridgeItemDto[];
}
