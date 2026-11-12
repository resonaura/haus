/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Global, Module } from '@nestjs/common';
import { HomeKitDiscoveryController } from './controller.js';
import { HomeKitControllerService } from './service.js';
import { HomeKitPublicationController } from './publication.controller.js';
import { HomeKitPublicationService } from './publication.service.js';
import { HAUS_HOMEKIT_CONTROLLER_SERVICE, HAUS_HOMEKIT_PUBLICATION_SERVICE } from './tokens.js';

@Global()
@Module({
  controllers: [HomeKitDiscoveryController, HomeKitPublicationController],
  providers: [
    HomeKitControllerService,
    HomeKitPublicationService,
    {
      provide: HAUS_HOMEKIT_CONTROLLER_SERVICE,
      useExisting: HomeKitControllerService,
    },
    {
      provide: HAUS_HOMEKIT_PUBLICATION_SERVICE,
      useExisting: HomeKitPublicationService,
    },
  ],
  exports: [
    HomeKitControllerService,
    HomeKitPublicationService,
    HAUS_HOMEKIT_CONTROLLER_SERVICE,
    HAUS_HOMEKIT_PUBLICATION_SERVICE,
  ],
})
export class HomeKitControllerModule {}
