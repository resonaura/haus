/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class KitsuneOnboardDto {
  @ApiProperty({
    example: { username: 'user@example.com', password: 'secretpassword' },
    description: 'Vendor onboarding credentials and setup fields',
  })
  @IsObject()
  fields!: Record<string, string>;
}

export class KitsuneCreateDeviceDto {
  @ApiProperty({
    example: { ip: '192.168.1.100', port: 554 },
    description: 'Vendor device connection settings',
  })
  @IsObject()
  settings!: Record<string, unknown>;
}

export class KitsuneVendorItemDto {
  @ApiProperty({ example: 'tuya', description: 'Vendor identifier' })
  id!: string;

  @ApiProperty({ example: 'Tuya Native Bridge', description: 'Display name' })
  name!: string;

  @ApiProperty({ example: true, description: 'Whether vendor bridge is enabled' })
  enabled!: boolean;

  @ApiProperty({ description: 'Plugin package route and version' })
  route!: Record<string, unknown>;
}

export class KitsuneCatalogResponseDto {
  @ApiProperty({
    type: [KitsuneVendorItemDto],
    description: 'List of available and installed Kitsune plugins',
  })
  vendors!: KitsuneVendorItemDto[];
}
