/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional } from 'class-validator';

export class UpdateStoragePolicyDto {
  @ApiProperty({
    example: 107374182400,
    description: 'Storage limit in bytes, or null for unlimited/default quota',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  storageLimitBytes!: number | null;
}

export class ServerItemDto {
  @ApiProperty({ example: 'home-assistant', description: 'Server identifier' })
  id!: string;

  @ApiProperty({ example: 'home-assistant', description: 'Server kind (home-assistant or nvr)' })
  kind!: string;

  @ApiProperty({ example: 'Home Assistant', description: 'Display name' })
  name!: string;

  @ApiProperty({ example: true, description: 'Whether server is currently online and responding' })
  online!: boolean;

  @ApiProperty({ example: 1730000000000, description: 'Timestamp of last heartbeat' })
  lastSeen!: number;

  @ApiProperty({ example: true, description: 'Whether node is enabled' })
  enabled!: boolean;

  @ApiProperty({ example: ['storage', 'stream'], description: 'Server roles' })
  roles!: string[];

  @ApiProperty({ description: 'Host CPU, memory and OS telemetry', required: false })
  host?: Record<string, unknown>;

  @ApiProperty({ description: 'Storage capacity and utilization', required: false })
  storage?: Record<string, unknown>;

  @ApiProperty({ description: 'Server settings and policies', required: false })
  settings?: Record<string, unknown>;
}

export class ServersStatusResponseDto {
  @ApiProperty({
    example: { monitoringOnlyServers: true },
    description: 'Supported server features',
  })
  features!: Record<string, boolean>;

  @ApiProperty({ type: [ServerItemDto], description: 'List of registered and discovered servers' })
  servers!: ServerItemDto[];

  @ApiProperty({ example: 1730000000000, description: 'Timestamp when metrics were sampled' })
  sampledAt!: number;
}
