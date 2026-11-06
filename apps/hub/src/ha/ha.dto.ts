/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString } from 'class-validator';

export class HaIntegrationSetupDto {
  @ApiProperty({
    example: 'http://192.168.4.44:8123',
    description: 'Home Assistant core instance URL',
  })
  @IsString()
  url!: string;

  @ApiProperty({ description: 'Authentication token or credentials' })
  @IsString()
  token!: string;
}

export class HaEnrollDto {
  @ApiProperty({ example: 'client-uuid-12345', description: 'HA camera client identifier' })
  @IsString()
  clientId!: string;

  @ApiProperty({ description: 'Enrollment options and capabilities' })
  @IsObject()
  options!: Record<string, unknown>;
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
