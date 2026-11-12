/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class AddNodeDto {
  @ApiProperty({ example: 'http://192.168.5.117:8790', description: 'Node base URL' })
  @IsString()
  url!: string;

  @ApiProperty({ example: 'Miku NVR Node', description: 'Node friendly name', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    example: 'sec-token-12345',
    description: 'Secret authentication token',
    required: false,
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiProperty({
    example: ['storage', 'stream'],
    description: 'Assigned node roles',
    required: false,
  })
  @IsOptional()
  @IsArray()
  roles?: string[];

  @ApiProperty({ example: 'hub-secondary-01', description: 'Joining Hub ID', required: false })
  @IsOptional()
  @IsString()
  nodeId?: string;

  @ApiProperty({ example: 'home-default', description: 'Target home ID', required: false })
  @IsOptional()
  @IsString()
  homeId?: string;
}

export class UpdateNodeDto {
  @ApiProperty({ example: true, description: 'Whether node is enabled', required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({
    example: 'Miku NVR Secondary',
    description: 'Node friendly name',
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    example: ['storage', 'stream'],
    description: 'Assigned node roles',
    required: false,
  })
  @IsOptional()
  @IsArray()
  roles?: string[];
}

export class ClusterNodeRecordDto {
  @ApiProperty({
    example: 'c1234567-89ab-cdef-0123-456789abcdef',
    description: 'Cluster node UUID',
  })
  id!: string;

  @ApiProperty({ example: 'Miku NVR Node', description: 'Friendly name' })
  name!: string;

  @ApiProperty({ example: 'http://192.168.5.117:8790', description: 'Node network URL' })
  url!: string;

  @ApiProperty({ example: true, description: 'Whether node is enabled' })
  enabled!: boolean;

  @ApiProperty({ example: ['storage', 'stream'], description: 'Assigned roles' })
  roles!: string[];

  @ApiProperty({ example: true, description: 'Whether node is online' })
  online!: boolean;

  @ApiProperty({ example: 'home-default', description: 'Shared home ID', required: false })
  @IsOptional()
  homeId?: string;
}

export class JoinClusterDto {
  @ApiProperty({ example: 'hub-secondary-01', description: 'Joining Hub ID' })
  @IsString()
  hubId!: string;

  @ApiProperty({ example: 'http://192.168.5.118:8790', description: 'Joining Hub URL' })
  @IsString()
  url!: string;

  @ApiProperty({ example: 'home-default', description: 'Target home ID' })
  @IsString()
  homeId!: string;

  @ApiProperty({
    example: 'Upstairs Hub',
    description: 'Joining Hub friendly name',
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: ['storage', 'stream'], description: 'Assigned node roles' })
  @IsArray()
  roles!: string[];

  @ApiProperty({ description: 'Pairing grant issued for joining node', required: false })
  @IsOptional()
  grant?: Record<string, unknown>;
}

export class JoinClusterResponseDto {
  @ApiProperty({ example: 'joined', description: 'Join status' })
  status!: string;

  @ApiProperty({ example: 'home-default', description: 'Shared home ID' })
  homeId!: string;

  @ApiProperty({ example: 'hub-main-01', description: 'Coordinator Hub ID' })
  coordinatorHubId!: string;

  @ApiProperty({ type: ClusterNodeRecordDto, description: 'Registered cluster node record' })
  node!: ClusterNodeRecordDto;
}

export class ClusterStatusResponseDto {
  @ApiProperty({ example: 'hub-0123456789', description: 'Cluster coordinator hub ID' })
  id!: string;

  @ApiProperty({ example: 'coordinator', description: 'Local role in cluster' })
  role!: string;

  @ApiProperty({ example: 1, description: 'Coordinator fencing epoch', required: false })
  @IsOptional()
  epoch?: number;

  @ApiProperty({
    example: false,
    description: 'Whether coordinator is fenced during transfer',
    required: false,
  })
  @IsOptional()
  fenced?: boolean;

  @ApiProperty({ type: [ClusterNodeRecordDto], description: 'Registered nodes' })
  nodes!: ClusterNodeRecordDto[];
}
