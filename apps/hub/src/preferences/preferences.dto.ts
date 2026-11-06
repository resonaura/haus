/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString } from 'class-validator';

export class PatchPreferencesDto {
  @ApiProperty({ example: 'rev-0123456789', description: 'Base revision expected by caller' })
  @IsString()
  baseRevision!: string;

  @ApiProperty({
    example: { favorites: ['light::living-room:ceiling'] },
    description: 'Preferences dictionary patch containing allowed config keys',
  })
  @IsObject()
  patch!: Record<string, unknown>;
}

export class PreferencesResponseDto {
  @ApiProperty({ example: 'rev-0123456789', description: 'Current preference revision' })
  revision!: string;

  @ApiProperty({ example: {}, description: 'Stored user and household preferences' })
  value!: Record<string, unknown>;

  @ApiProperty({
    example: 1730000000000,
    description: 'Timestamp when preferences were last modified',
  })
  updatedAt!: number;
}
