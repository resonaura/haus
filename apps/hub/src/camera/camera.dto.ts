/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CameraOperatingDto {
  @ApiProperty({
    description: 'Hardware control target',
    enum: ['indicator', 'nightVision'],
    example: 'indicator',
  })
  @IsIn(['indicator', 'nightVision'], { message: 'invalid_camera_control' })
  control!: 'indicator' | 'nightVision';

  @ApiProperty({
    description: 'Entity ID associated with the control',
    example: 'switch.porch_status_light',
  })
  @IsString({ message: 'invalid_camera_control' })
  @IsNotEmpty({ message: 'invalid_camera_control' })
  entityId!: string;

  @ApiProperty({
    description: 'Desired binary state for the target control',
    example: true,
  })
  @IsBoolean({ message: 'invalid_camera_control' })
  value!: boolean;
}

export class CameraViewerDto {
  @ApiProperty({ description: 'Client owner session key', example: 'session-123' })
  @IsString()
  @IsNotEmpty()
  owner!: string;

  @ApiProperty({ description: 'Unique viewer peer connection identifier', example: 'peer-456' })
  @IsString()
  @IsNotEmpty()
  viewerId!: string;

  @ApiPropertyOptional({ description: 'WebRTC SDP offer payload' })
  @IsOptional()
  offer?: unknown;
}

export class CameraViewerCloseDto {
  @ApiProperty({ description: 'Client owner session key', example: 'session-123' })
  @IsString()
  @IsNotEmpty()
  owner!: string;

  @ApiProperty({ description: 'Unique viewer peer connection identifier', example: 'peer-456' })
  @IsString()
  @IsNotEmpty()
  viewerId!: string;
}

export class CameraWarmDto {
  @ApiProperty({ description: 'Client owner session key', example: 'session-123' })
  @IsString()
  @IsNotEmpty()
  owner!: string;

  @ApiProperty({ description: 'Whether warm streaming session is active', example: true })
  @IsBoolean()
  active!: boolean;

  @ApiPropertyOptional({ description: 'Touch session in preview preheat mode', example: false })
  @IsOptional()
  @IsBoolean()
  preview?: boolean;
}

export class CameraAccessBootstrapDto {
  @ApiProperty({ description: 'Canonical camera entity ID', example: 'camera.porch' })
  @IsString()
  @IsNotEmpty()
  cameraId!: string;

  @ApiProperty({ description: 'Unique client device identifier', example: 'mobile-client-1' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;
}

export class CameraUpdateDto {
  @ApiPropertyOptional({ description: 'Master recording & stream enablement', example: true })
  @IsOptional()
  @IsBoolean({ message: 'invalid_enabled' })
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Bound motion/presence sensor entity IDs',
    example: ['binary_sensor.porch_pir'],
  })
  @IsOptional()
  @IsArray({ message: 'invalid_detectors' })
  @IsString({ each: true, message: 'invalid_detectors' })
  sensorIds?: string[] | null;

  @ApiPropertyOptional({ description: 'Custom talkback audio configuration' })
  @IsOptional()
  talkback?: unknown;

  @ApiPropertyOptional({ description: 'Software motion detection configuration' })
  @IsOptional()
  motionDetection?: unknown;
}

export class HomeKitSettingsDto {
  @ApiPropertyOptional({ description: 'Assigned transcoding processor node', example: 'auto' })
  @IsOptional()
  @IsString()
  processor?: string;

  @ApiPropertyOptional({ description: 'Image rotation degrees', example: 0 })
  @IsOptional()
  rotation?: number;

  @ApiPropertyOptional({ description: 'Vertical flip orientation', example: false })
  @IsOptional()
  @IsBoolean()
  verticalFlip?: boolean;

  @ApiPropertyOptional({ description: 'Horizontal flip orientation', example: false })
  @IsOptional()
  @IsBoolean()
  horizontalFlip?: boolean;
}
