/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable } from '@nestjs/common';
import type { IStatusService } from './status.controller.js';
import type { HubStatusResponseDto } from './status.dto.js';

@Injectable()
export class DefaultStatusService implements IStatusService {
  private mode: string = process.env.HAUS_STANDALONE === '1' ? 'standalone' : 'supervised';
  private haConnected = false;

  setMode(mode: string): void {
    this.mode = mode;
  }

  setHaConnected(connected: boolean): void {
    this.haConnected = connected;
  }

  status(): HubStatusResponseDto {
    return {
      protocol: 1,
      name: 'Haus',
      version: '0.3.76',
      features: {
        homekitSecureVideo: true,
        cluster: true,
        sharedPreferences: true,
        previewPreheat: true,
        verifiedOriginalPlayback: true,
      },
      connected: this.haConnected,
      recordingEnabled: true,
      storage: {
        total: 64 * 1024 * 1024 * 1024,
        used: 10 * 1024 * 1024 * 1024,
      },
    };
  }
}
