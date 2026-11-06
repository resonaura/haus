/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import {
  ProvidersController,
  PROVIDERS_SERVICE,
  type IProvidersService,
} from './providers.controller.js';

export { PROVIDERS_SERVICE, type IProvidersService };

@Module({
  controllers: [ProvidersController],
  providers: [
    {
      provide: PROVIDERS_SERVICE,
      useValue: undefined,
    },
  ],
  exports: [PROVIDERS_SERVICE],
})
export class ProvidersModule {
  static forRoot(service?: IProvidersService): DynamicModule {
    return {
      module: ProvidersModule,
      controllers: [ProvidersController],
      providers: [
        {
          provide: PROVIDERS_SERVICE,
          useValue: service,
        },
      ],
      exports: [PROVIDERS_SERVICE],
    };
  }
}
