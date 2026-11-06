/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ControlController } from './control.controller.js';
import { ControlService } from './service.js';
import { CONTROL_SERVICE } from './types.js';

export { CONTROL_SERVICE };

@Module({
  controllers: [ControlController],
  providers: [
    {
      provide: CONTROL_SERVICE,
      useValue: undefined,
    },
  ],
  exports: [CONTROL_SERVICE],
})
export class ControlModule {
  static forRoot(service?: ControlService): DynamicModule {
    return {
      module: ControlModule,
      controllers: [ControlController],
      providers: [
        {
          provide: CONTROL_SERVICE,
          useValue: service,
        },
      ],
      exports: [CONTROL_SERVICE],
    };
  }
}
