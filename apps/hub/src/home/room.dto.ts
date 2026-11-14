/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateIf } from 'class-validator';

export class CreateRoomDto {
  @ApiProperty({ required: false, example: 'office' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Office' })
  @IsString()
  name!: string;

  @ApiProperty({ required: false, example: 'office' })
  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdateRoomDto {
  @ApiProperty({ required: false, example: 'Study' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, nullable: true, example: 'desk' })
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @IsString()
  icon?: string | null;
}

export class UpdateDeviceDto {
  @ApiProperty({ required: false, example: 'Reading Lamp' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, nullable: true, example: 'office' })
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @IsString()
  roomId?: string | null;
}
