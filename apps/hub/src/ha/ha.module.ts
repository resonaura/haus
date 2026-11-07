/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { HaController, HA_CAMERAS_SERVICE, type IHaCamerasService } from './ha.controller.js';

export { HA_CAMERAS_SERVICE, type IHaCamerasService };

@Module({
  controllers: [HaController],
  providers: [
    {
      provide: HA_CAMERAS_SERVICE,
      useValue: undefined,
    },
  ],
  exports: [HA_CAMERAS_SERVICE],
})
export class HaCamerasModule {
  static forRoot(service?: IHaCamerasService): DynamicModule {
    return {
      module: HaCamerasModule,
      controllers: [HaController],
      providers: [
        {
          provide: HA_CAMERAS_SERVICE,
          useValue: service,
        },
      ],
      exports: [HA_CAMERAS_SERVICE],
    };
  }
}
