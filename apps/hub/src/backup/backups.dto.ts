/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class CreateBackupDto {
  @ApiProperty({
    example: 'haus',
    description: 'Backup kind: "haus" (configuration snapshot) or "ha" (Supervisor backup)',
    enum: ['haus', 'ha'],
  })
  @IsString()
  @IsIn(['haus', 'ha'])
  kind!: 'haus' | 'ha';
}

export class BackupItemDto {
  @ApiProperty({ example: 'haus-backup-2026-11-05.tar.gz', description: 'Backup archive filename' })
  filename!: string;

  @ApiProperty({ example: 'haus', description: 'Backup kind ("haus" or "ha")' })
  kind!: string;

  @ApiProperty({ example: 1048576, description: 'Archive file size in bytes' })
  size!: number;

  @ApiProperty({ example: 1730000000000, description: 'Creation timestamp' })
  createdAt!: number;
}

export class BackupsListResponseDto {
  @ApiProperty({ type: [BackupItemDto], description: 'List of existing backup archives' })
  items!: BackupItemDto[];

  @ApiProperty({
    example: false,
    description: 'Whether a backup operation is currently in progress',
  })
  busy!: boolean;

  @ApiProperty({ example: null, description: 'Last backup error message, if any', nullable: true })
  error!: string | null;
}

export class RecoveryKitResponseDto {
  @ApiProperty({ example: 'rec-key-abcdef', description: 'Decryption recovery key' })
  recoveryKey!: string;

  @ApiProperty({ description: 'Cluster nodes available for recovery' })
  nodes!: Array<Record<string, unknown>>;
}
