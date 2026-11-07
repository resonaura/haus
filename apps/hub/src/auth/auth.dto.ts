/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import type { ClientIdentity, PairingGrant } from '@haus/core/pairing';

export class ChallengeRequestDto {
  @ApiProperty({ description: 'Optional pairing challenge code', required: false })
  @IsOptional()
  @IsString()
  challengeCode?: string;

  @ApiProperty({ description: 'Optional challenge TTL in milliseconds', required: false })
  @IsOptional()
  @IsNumber()
  ttlMs?: number;
}

export class ConfirmChallengeRequestDto {
  @ApiProperty({ description: 'Pairing offer session ID' })
  @IsString()
  sessionId!: string;

  @ApiProperty({ description: 'Client identity attempting to pair' })
  @IsObject()
  client!: ClientIdentity;

  @ApiProperty({ description: 'Challenge code displayed/provided by Hub' })
  @IsString()
  challengeCode!: string;

  @ApiProperty({ description: 'Optional expected home ID', required: false })
  @IsOptional()
  @IsString()
  expectedHomeId?: string;
}

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
