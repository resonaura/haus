/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export type TransferState =
  'initiated' | 'target_prepared' | 'source_fenced' | 'completed' | 'rolled_back';

export class InitiateTransferDto {
  @ApiProperty({ description: 'Target Hub UUID to transfer coordinator status to' })
  @IsString()
  targetHubId!: string;

  @ApiProperty({
    description: 'Whether to preserve HomeKit pairing and controller keys (default true)',
    required: false,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  preservePairing?: boolean;
}

export class TransferSummaryDto {
  @ApiProperty({ description: 'Total count of devices transferred' })
  devicesCount!: number;

  @ApiProperty({ description: 'Total count of endpoint states transferred' })
  endpointStatesCount!: number;

  @ApiProperty({ description: 'Total count of scenes transferred' })
  scenesCount!: number;

  @ApiProperty({ description: 'Total count of scripts transferred' })
  scriptsCount!: number;

  @ApiProperty({ description: 'Total count of automations transferred' })
  automationsCount!: number;

  @ApiProperty({ description: 'Total count of recording archives preserved' })
  archivesCount!: number;

  @ApiProperty({ description: 'Whether HomeKit pairing was preserved' })
  preservePairing!: boolean;
}

export class HubTransferIntentDto {
  @ApiProperty({ description: 'Unique transfer session identifier' })
  transferId!: string;

  @ApiProperty({ description: 'Shared home identifier' })
  homeId!: string;

  @ApiProperty({ description: 'Source coordinator Hub UUID' })
  sourceHubId!: string;

  @ApiProperty({ description: 'Target secondary Hub UUID' })
  targetHubId!: string;

  @ApiProperty({ description: 'Monotonically increasing coordinator fencing epoch' })
  epoch!: number;

  @ApiProperty({ description: 'Deterministic SHA-256 checksum of transfer manifest' })
  checksum!: string;

  @ApiProperty({
    description: 'Current state of transfer lifecycle',
    enum: ['initiated', 'target_prepared', 'source_fenced', 'completed', 'rolled_back'],
  })
  state!: TransferState;

  @ApiProperty({ description: 'Statistical summary of transferred household entities' })
  summary!: TransferSummaryDto;

  @ApiProperty({ description: 'Unix epoch timestamp of initiation' })
  createdAt!: number;

  @ApiProperty({ description: 'Unix epoch timestamp of source fencing', required: false })
  fencedAt?: number;

  @ApiProperty({ description: 'Unix epoch timestamp of completion', required: false })
  completedAt?: number;

  @ApiProperty({ description: 'Unix epoch timestamp of rollback', required: false })
  rolledBackAt?: number;

  @ApiProperty({ description: 'Reason for rollback if aborted', required: false })
  rollbackReason?: string;
}

export class HubTransferCommitResultDto {
  @ApiProperty({ description: 'Transfer identifier' })
  transferId!: string;

  @ApiProperty({ description: 'Final state', example: 'completed' })
  state!: 'completed';

  @ApiProperty({ description: 'Previous coordinator Hub UUID' })
  previousCoordinator!: string;

  @ApiProperty({ description: 'New active coordinator Hub UUID' })
  newCoordinator!: string;

  @ApiProperty({ description: 'Home identifier' })
  homeId!: string;

  @ApiProperty({ description: 'Active coordinator epoch' })
  epoch!: number;

  @ApiProperty({ description: 'Completion timestamp' })
  completedAt!: number;
}

export class HubTransferRollbackResultDto {
  @ApiProperty({ description: 'Transfer identifier' })
  transferId!: string;

  @ApiProperty({ description: 'Final state', example: 'rolled_back' })
  state!: 'rolled_back';

  @ApiProperty({ description: 'Restored coordinator Hub UUID' })
  restoredCoordinator!: string;

  @ApiProperty({ description: 'Rollback reason' })
  reason!: string;

  @ApiProperty({ description: 'Rollback timestamp' })
  rolledBackAt!: number;
}
