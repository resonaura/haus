/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';

export class StatusFeaturesDto {
  @ApiProperty({ example: true })
  homekitSecureVideo!: boolean;

  @ApiProperty({ example: true })
  cluster!: boolean;

  @ApiProperty({ example: true })
  sharedPreferences!: boolean;

  @ApiProperty({ example: true })
  previewPreheat!: boolean;

  @ApiProperty({ example: true })
  verifiedOriginalPlayback!: boolean;

  @ApiProperty({ example: true })
  recordingRepair!: boolean;
}

export class HubStatusResponseDto {
  @ApiProperty({ example: 1, description: 'Haus Hub protocol version' })
  protocol!: number;

  @ApiProperty({ example: 'Haus', description: 'System application name' })
  name!: string;

  @ApiProperty({ example: '0.3.76', description: 'Haus Hub version' })
  version!: string;

  @ApiProperty({ type: StatusFeaturesDto, description: 'Enabled system features' })
  features!: Record<string, boolean>;

  @ApiProperty({ example: 'standalone', description: 'Runtime composition mode', required: false })
  mode?: string;

  @ApiProperty({ example: true, description: 'Connection status to primary core' })
  connected!: boolean;

  @ApiProperty({ example: true, description: 'Whether camera recording is active' })
  recordingEnabled!: boolean;

  @ApiProperty({ description: 'Storage capacity and utilization totals' })
  storage!: Record<string, unknown>;

  @ApiProperty({ description: 'Camera recorder ring buffer status', required: false })
  buffers?: unknown;

  @ApiProperty({ description: 'Media processing queue status', required: false })
  processing?: unknown;
}
