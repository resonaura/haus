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
  @ApiProperty({ example: 'hub-standalone-01', description: 'Server identifier' })
  id!: string;

  @ApiProperty({ example: 'hub', description: 'Server kind (hub, home-assistant, or nvr)' })
  kind!: string;

  @ApiProperty({
    example: true,
    description: 'Whether this entry represents the local Hub serving the request',
    required: false,
  })
  local?: boolean;

  @ApiProperty({ example: 'Haus Hub', description: 'Display name' })
  name!: string;

  @ApiProperty({ example: 'http://192.168.4.44:8790', description: 'Hub URL', required: false })
  url?: string;

  @ApiProperty({ example: true, description: 'Whether server is currently online and responding' })
  online!: boolean;

  @ApiProperty({ example: 1730000000000, description: 'Timestamp of last heartbeat' })
  lastSeen!: number | null;

  @ApiProperty({ example: true, description: 'Whether node is enabled' })
  enabled!: boolean;

  @ApiProperty({ example: ['coordinator', 'storage', 'stream'], description: 'Server roles' })
  roles!: string[];

  @ApiProperty({ example: 0, description: 'Live stream routing priority', required: false })
  livePriority?: number;

  @ApiProperty({ description: 'Linked SSH server identifier', required: false })
  sshServerId?: string;

  @ApiProperty({
    description: 'Host CPU, memory and OS telemetry',
    required: false,
    nullable: true,
  })
  host?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Storage capacity and utilization', required: false, nullable: true })
  storage?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Server settings and policies', required: false })
  settings?: Record<string, unknown>;

  @ApiProperty({ description: 'Active/max stream counts', required: false })
  streams?: Record<string, unknown>;

  @ApiProperty({ description: 'Active/max analysis detector counts', required: false })
  analysis?: Record<string, unknown>;

  @ApiProperty({ description: 'Active/max playback preparation counts', required: false })
  playback?: Record<string, unknown>;

  @ApiProperty({ description: 'Count of encrypted backup copies stored', required: false })
  backupCopies?: number;

  @ApiProperty({
    description: 'Last error reported for this server',
    required: false,
    nullable: true,
  })
  error?: string | null;
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
