/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { BackupsController, BACKUPS_SERVICE, type IBackupsService } from './backups.controller.js';
import { DefaultBackupsService } from './backups.service.js';

export { BACKUPS_SERVICE, type IBackupsService, DefaultBackupsService };

@Module({
  controllers: [BackupsController],
  providers: [
    DefaultBackupsService,
    {
      provide: BACKUPS_SERVICE,
      useExisting: DefaultBackupsService,
    },
  ],
  exports: [BACKUPS_SERVICE, DefaultBackupsService],
})
export class BackupsModule {
  static forRoot(service?: IBackupsService): DynamicModule {
    return {
      module: BackupsModule,
      controllers: [BackupsController],
      providers: [
        service
          ? {
              provide: BACKUPS_SERVICE,
              useValue: service,
            }
          : {
              provide: BACKUPS_SERVICE,
              useClass: DefaultBackupsService,
            },
      ],
      exports: [BACKUPS_SERVICE],
    };
  }
}
