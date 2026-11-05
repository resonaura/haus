/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsObject, IsOptional, IsString } from 'class-validator';

export class ConnectIntegrationDto {
  @ApiProperty({ description: 'Credential payload required by provider', required: true })
  @IsDefined()
  credential!: unknown;
}

export class CommandPayloadDto {
  @ApiProperty({ example: 'cmd-1', description: 'Command identifier' })
  @IsString()
  id!: string;

  @ApiProperty({ example: 'ep-1', description: 'Target endpoint identifier' })
  @IsString()
  endpointId!: string;

  @ApiProperty({ example: 'cap-switch', description: 'Target capability identifier' })
  @IsString()
  capabilityId!: string;

  @ApiProperty({ example: 'turn_on', description: 'Operation name' })
  @IsString()
  operation!: string;

  @ApiProperty({ example: { brightness: 100 }, description: 'Command arguments', required: false })
  @IsOptional()
  @IsObject()
  arguments?: Record<string, unknown>;
}

export class DispatchCommandDto {
  @ApiProperty({ example: 'idem-1234567890', description: 'Idempotency correlation key' })
  @IsString()
  idempotencyKey!: string;

  @ApiProperty({ description: 'Command payload to execute' })
  @IsObject()
  command!: CommandPayloadDto;
}
