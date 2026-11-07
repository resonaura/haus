/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LIVE_SERVICE } from './tokens.js';
import type { LiveService } from './types.js';
import { HubLiveService } from './live.service.js';
import { LiveGateway } from './live.gateway.js';

@Module({
  providers: [
    HubLiveService,
    {
      provide: LIVE_SERVICE,
      useExisting: HubLiveService,
    },
    LiveGateway,
  ],
  exports: [LIVE_SERVICE, HubLiveService, LiveGateway],
})
export class LiveModule {
  static forRoot(customService?: LiveService): DynamicModule {
    const serviceProvider = customService
      ? { provide: LIVE_SERVICE, useValue: customService }
      : { provide: LIVE_SERVICE, useClass: HubLiveService };

    return {
      module: LiveModule,
      providers: [serviceProvider, LiveGateway],
      exports: [LIVE_SERVICE, LiveGateway],
    };
  }
}
