/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import type {
  AutomationCondition,
  AutomationTrigger,
  ExecutionMode,
  HausDevice,
  SceneMemberState,
  ScriptStep,
} from '@haus/core';
import type { AppAction, AppManifest, AppOperation, AppPermissionType } from '@haus/apps';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'dev-living-light' })
  @IsString()
  id!: string;

  @ApiProperty({ example: 'Living Room Ceiling Light' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'lighting', required: false })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ example: 'room-living', required: false })
  @IsOptional()
  @IsString()
  roomId?: string;

  @ApiProperty({ example: 'room-living', required: false })
  @IsOptional()
  @IsString()
  areaId?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  available?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  endpoints?: HausDevice['endpoints'];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  services?: HausDevice['services'];
}

export class DeviceCommandDto {
  @ApiProperty({ example: 'ep-living-light-main' })
  @IsString()
  endpointId!: string;

  @ApiProperty({ example: 'on_off' })
  @IsString()
  capability!: string;

  @ApiProperty({ example: 'turn_on' })
  @IsString()
  command!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

export class MoveDeviceRoomDto {
  @ApiProperty({ example: 'kitchen' })
  @IsString()
  targetRoomId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  expectedRevision?: number;

  @ApiProperty({ required: false, enum: ['reject', 'auto_suffix'] })
  @IsOptional()
  @IsString()
  collisionPolicy?: 'reject' | 'auto_suffix';
}

export class RegisterSceneDto {
  @ApiProperty({ example: 'scene-movie-night' })
  @IsString()
  id!: string;

  @ApiProperty({ example: 'Movie Night' })
  @IsString()
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  roomId?: string;

  @ApiProperty({ description: 'Scene member target states' })
  @IsArray()
  members!: SceneMemberState[];
}

export class RegisterScriptDto {
  @ApiProperty({ example: 'script-goodnight' })
  @IsString()
  id!: string;

  @ApiProperty({ example: 'Goodnight Routine' })
  @IsString()
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  mode?: ExecutionMode;

  @ApiProperty({ description: 'Script execution steps' })
  @IsArray()
  steps!: ScriptStep[];
}

export class RegisterAutomationDto {
  @ApiProperty({ example: 'rule-motion-hallway' })
  @IsString()
  id!: string;

  @ApiProperty({ example: 'Hallway Motion Light' })
  @IsString()
  name!: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  mode?: ExecutionMode;

  @ApiProperty({ description: 'Automation triggers' })
  @IsArray()
  triggers!: AutomationTrigger[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  conditions?: AutomationCondition[];

  @ApiProperty({ description: 'Automation action steps' })
  @IsArray()
  actions!: ScriptStep[];
}

export class DispatchAutomationEventDto {
  @ApiProperty({ example: 'state' })
  @IsString()
  type!: 'state' | 'event' | 'numeric_state' | 'time';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  endpointId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  property?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  from?: unknown;

  @ApiProperty({ required: false })
  @IsOptional()
  to?: unknown;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  numericValue?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  eventData?: Record<string, unknown>;
}

export class InstallStandaloneAppDto {
  @ApiProperty({ description: 'App manifest definition' })
  @IsObject()
  manifest!: AppManifest;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  grantedPermissions?: AppPermissionType[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class ExecuteAppActionDto {
  @ApiProperty({ example: 'start' })
  @IsString()
  action!: AppAction;
}

export class OperateAppDto {
  @ApiProperty({ example: 'logs' })
  @IsString()
  operation!: AppOperation;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}

export class UpdateAppDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  grantedPermissions?: AppPermissionType[];
}
