/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { KitsuneController, KITSUNE_SERVICE, type IKitsuneService } from './kitsune.controller.js';
import { StandaloneKitsuneService } from './kitsune.service.js';

export { KITSUNE_SERVICE, StandaloneKitsuneService, type IKitsuneService };

@Module({
  controllers: [KitsuneController],
  providers: [
    StandaloneKitsuneService,
    {
      provide: KITSUNE_SERVICE,
      useExisting: StandaloneKitsuneService,
    },
  ],
  exports: [KITSUNE_SERVICE, StandaloneKitsuneService],
})
export class KitsuneModule {
  static forRoot(service?: IKitsuneService | null): DynamicModule {
    return {
      module: KitsuneModule,
      controllers: [KitsuneController],
      providers:
        service === null
          ? [{ provide: KITSUNE_SERVICE, useValue: undefined }]
          : service
            ? [{ provide: KITSUNE_SERVICE, useValue: service }]
            : [
                StandaloneKitsuneService,
                { provide: KITSUNE_SERVICE, useExisting: StandaloneKitsuneService },
              ],
      exports: [KITSUNE_SERVICE],
    };
  }
}
