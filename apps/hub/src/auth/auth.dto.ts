/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';
import type { PairingGrant } from '@haus/core/pairing';

export class PairRequestDto {
  @ApiProperty({ description: 'Pairing grant issued during pairing challenge handshake' })
  @IsObject()
  grant!: PairingGrant;
}

export class ResumeRequestDto {
  @ApiProperty({ example: 'csess-0123456789abcdef', description: 'Active client session ID' })
  @IsString()
  sessionId!: string;
}

export class RefreshRequestDto {
  @ApiProperty({ example: 'csess-0123456789abcdef', description: 'Client session ID' })
  @IsString()
  sessionId!: string;

  @ApiProperty({ description: 'Secret refresh token' })
  @IsString()
  refreshToken!: string;
}

export class LogoutRequestDto {
  @ApiProperty({
    example: 'csess-0123456789abcdef',
    description: 'Client session ID to terminate',
    required: false,
  })
  @IsOptional()
  @IsString()
  sessionId?: string;
}
