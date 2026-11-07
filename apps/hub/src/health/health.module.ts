/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { HAUS_RUNTIME_MODE, HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: HAUS_RUNTIME_MODE,
      useValue: 'standalone',
    },
  ],
  exports: [HAUS_RUNTIME_MODE],
})
export class HealthModule {
  static forRoot(mode: string = 'standalone'): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [
        {
          provide: HAUS_RUNTIME_MODE,
          useValue: mode,
        },
      ],
      exports: [HAUS_RUNTIME_MODE],
    };
  }
}
