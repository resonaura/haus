/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { LiveModule } from '../live/live.module.js';
import { HomeController } from './home.controller.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from './home.service.js';

@Module({
  imports: [LiveModule],
  controllers: [HomeController],
  providers: [
    StandaloneHomeService,
    {
      provide: STANDALONE_HOME_SERVICE,
      useExisting: StandaloneHomeService,
    },
  ],
  exports: [STANDALONE_HOME_SERVICE, StandaloneHomeService],
})
export class HomeModule {
  static forRoot(service?: StandaloneHomeService): DynamicModule {
    return {
      module: HomeModule,
      imports: [LiveModule],
      controllers: [HomeController],
      providers: service
        ? [{ provide: STANDALONE_HOME_SERVICE, useValue: service }]
        : [
            StandaloneHomeService,
            { provide: STANDALONE_HOME_SERVICE, useExisting: StandaloneHomeService },
          ],
      exports: [STANDALONE_HOME_SERVICE],
    };
  }
}
