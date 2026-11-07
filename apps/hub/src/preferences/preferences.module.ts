/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import {
  PreferencesController,
  PREFERENCES_SERVICE,
  type IPreferencesService,
} from './preferences.controller.js';
import { DefaultPreferencesService } from './preferences.service.js';

export { PREFERENCES_SERVICE, type IPreferencesService, DefaultPreferencesService };

@Module({
  controllers: [PreferencesController],
  providers: [
    DefaultPreferencesService,
    {
      provide: PREFERENCES_SERVICE,
      useExisting: DefaultPreferencesService,
    },
  ],
  exports: [PREFERENCES_SERVICE, DefaultPreferencesService],
})
export class PreferencesModule {
  static forRoot(service?: IPreferencesService): DynamicModule {
    return {
      module: PreferencesModule,
      controllers: [PreferencesController],
      providers: [
        service
          ? {
              provide: PREFERENCES_SERVICE,
              useValue: service,
            }
          : {
              provide: PREFERENCES_SERVICE,
              useClass: DefaultPreferencesService,
            },
      ],
      exports: [PREFERENCES_SERVICE],
    };
  }
}
