/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

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
    example: 'sec-key-12345',
    description: 'Node pairing key alias for token',
    required: false,
  })
  @IsOptional()
  @IsString()
  key?: string;

  @ApiProperty({
    example: ['storage', 'stream'],
    description: 'Assigned node roles',
    required: false,
  })
  @IsOptional()
  @IsArray()
  roles?: string[];

  @ApiProperty({
    example: true,
    description: 'Allow HTTP transport on trusted LAN',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  allowHttp?: boolean;

  @ApiProperty({
    example: 'ssh:...',
    description: 'Linked SSH monitoring server ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  sshServerId?: string;

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

  @ApiProperty({ example: 50, description: 'Live streaming priority (0..100)', required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  livePriority?: number;

  @ApiProperty({
    example: 107374182400,
    description: 'Storage quota in bytes',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  storageLimitBytes?: number | null;

  @ApiProperty({
    example: 'ssh:...',
    description: 'Linked SSH monitoring server ID',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  sshServerId?: string | null;
}

export class ClusterNodeRecordDto {
  @ApiProperty({
    example: 'c1234567-89ab-cdef-0123-456789abcdef',
    description: 'Cluster node UUID',
  })
  id!: string;

  @ApiProperty({ example: 'c1234567-89ab-cdef-0123-456789abcdef', required: false })
  @IsOptional()
  pairedNodeId?: string;

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

  @ApiProperty({ required: false })
  @IsOptional()
  allowHttp?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  livePriority?: number;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  storageLimitBytes?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  sshServerId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  lastSeen?: number;
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

  @ApiProperty({ description: 'Public cryptographic identity of joining Hub', required: false })
  @IsOptional()
  publicIdentity?: {
    readonly hubId: string;
    readonly signingPublicKey: string;
    readonly exchangePublicKey: string;
    readonly keyFingerprint: string;
  };
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

  @ApiProperty({ description: 'Coordinator public cryptographic identity', required: false })
  coordinatorPublicIdentity?: {
    readonly hubId: string;
    readonly signingPublicKey: string;
    readonly exchangePublicKey: string;
    readonly keyFingerprint: string;
  };

  @ApiProperty({ description: 'Provisioned per-peer HMAC channel secret', required: false })
  channelSecret?: string;

  @ApiProperty({ example: 1, description: 'Current coordinator fencing epoch', required: false })
  coordinatorEpoch?: number;
}

export class AttachClusterDto {
  @ApiProperty({
    example: 'http://192.168.5.117:8790',
    description: 'Primary Coordinator Hub URL',
  })
  @IsString()
  coordinatorUrl!: string;

  @ApiProperty({
    example: ['storage', 'stream'],
    description: 'Assigned roles for this secondary Hub',
    required: false,
  })
  @IsOptional()
  @IsArray()
  roles?: string[];

  @ApiProperty({
    example: 'http://192.168.5.221:8790',
    description: 'Reachable URL of this secondary Hub for peer RPCs',
    required: false,
  })
  @IsOptional()
  @IsString()
  selfUrl?: string;

  @ApiProperty({ example: 'Secondary Mac Hub', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'Miku Primary', required: false })
  @IsOptional()
  @IsString()
  coordinatorName?: string;

  @ApiProperty({ example: 'home-default', required: false })
  @IsOptional()
  @IsString()
  homeId?: string;

  @ApiProperty({ description: 'Pairing grant issued by Coordinator Hub' })
  @IsObject()
  grant!: Record<string, unknown>;

  @ApiProperty({
    description: 'Transient Coordinator bearer token used to authorize /api/cluster/join',
    required: false,
  })
  @IsOptional()
  @IsString()
  coordinatorToken?: string;
}

export class RemoveNodeOptionsDto {
  @ApiProperty({
    example: false,
    description: 'Force removal even when node is offline or holds un-evacuated sole-copy data',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiProperty({
    example: 'hub-main-01',
    description: 'Preferred destination Hub ID for workload handoff during drain',
    required: false,
  })
  @IsOptional()
  @IsString()
  targetHubId?: string;
}

export class RebalanceClusterDto {
  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiProperty({ description: 'Optional map of workloadId -> preferredHubId', required: false })
  @IsOptional()
  preferences?: Record<string, string>;
}

export class ClusterStatusResponseDto {
  @ApiProperty({ example: 'hub-0123456789', description: 'Cluster coordinator hub ID' })
  id!: string;

  @ApiProperty({
    example: 'hub-0123456789',
    description: 'Cluster coordinator hub ID',
    required: false,
  })
  @IsOptional()
  coordinatorId?: string;

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
