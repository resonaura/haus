/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { IStatusService } from './status.controller.js';
import type { HubStatusResponseDto } from './status.dto.js';

export const SUPPORTED_HA_APPLIANCES = new Set<string>([
  'ha-green',
  'ha-yellow',
  'ha-os',
  'ha-supervised',
  'ha',
]);

export function isExplicitHaAppliance(
  appliance?: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const candidate = (appliance ?? env.HAUS_APPLIANCE ?? '').trim().toLowerCase();
  if (candidate && SUPPORTED_HA_APPLIANCES.has(candidate)) {
    return true;
  }
  if (env.HAUS_MODE === 'ha-appliance' || env.HAUS_STANDALONE === '0') {
    return true;
  }
  return false;
}

@Injectable()
export class DefaultStatusService implements IStatusService {
  private mode: string;
  private haConnected = false;

  constructor(@Optional() @Inject('HAUS_APPLIANCE') appliance?: string) {
    this.mode = isExplicitHaAppliance(appliance) ? 'ha-appliance' : 'standalone';
  }

  setMode(mode: string): void {
    this.mode = mode;
  }

  getMode(): string {
    return this.mode;
  }

  setHaConnected(connected: boolean): void {
    this.haConnected = connected;
  }

  status(): HubStatusResponseDto {
    const standalone = this.mode === 'standalone';
    return {
      protocol: 1,
      name: 'Haus',
      version: '0.3.76',
      mode: this.mode,
      features: {
        homekitSecureVideo: true,
        cluster: true,
        sharedPreferences: true,
        previewPreheat: true,
        verifiedOriginalPlayback: true,
        standaloneDomain: standalone,
      },
      connected: standalone ? true : this.haConnected,
      recordingEnabled: true,
      storage: {
        total: 64 * 1024 * 1024 * 1024,
        used: 10 * 1024 * 1024 * 1024,
      },
    };
  }
}
