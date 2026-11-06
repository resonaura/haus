/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { KitsuneController, KITSUNE_SERVICE, type IKitsuneService } from './kitsune.controller.js';

export { KITSUNE_SERVICE, type IKitsuneService };

@Module({
  controllers: [KitsuneController],
  providers: [
    {
      provide: KITSUNE_SERVICE,
      useValue: undefined,
    },
  ],
  exports: [KITSUNE_SERVICE],
})
export class KitsuneModule {
  static forRoot(service?: IKitsuneService): DynamicModule {
    return {
      module: KitsuneModule,
      controllers: [KitsuneController],
      providers: [
        {
          provide: KITSUNE_SERVICE,
          useValue: service,
        },
      ],
      exports: [KITSUNE_SERVICE],
    };
  }
}
