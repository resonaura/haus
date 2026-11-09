/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Global, Module } from '@nestjs/common';
import { HomeKitDiscoveryController } from './controller.js';
import { HomeKitControllerService } from './service.js';
import { HAUS_HOMEKIT_CONTROLLER_SERVICE } from './tokens.js';

@Global()
@Module({
  controllers: [HomeKitDiscoveryController],
  providers: [
    HomeKitControllerService,
    {
      provide: HAUS_HOMEKIT_CONTROLLER_SERVICE,
      useExisting: HomeKitControllerService,
    },
  ],
  exports: [HomeKitControllerService, HAUS_HOMEKIT_CONTROLLER_SERVICE],
})
export class HomeKitControllerModule {}
