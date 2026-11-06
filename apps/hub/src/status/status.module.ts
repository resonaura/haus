/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { StatusController, STATUS_SERVICE, type IStatusService } from './status.controller.js';
import { DefaultStatusService } from './status.service.js';

export { STATUS_SERVICE, type IStatusService, DefaultStatusService };

@Module({
  controllers: [StatusController],
  providers: [
    DefaultStatusService,
    {
      provide: STATUS_SERVICE,
      useExisting: DefaultStatusService,
    },
  ],
  exports: [STATUS_SERVICE, DefaultStatusService],
})
export class StatusModule {
  static forRoot(service?: IStatusService): DynamicModule {
    return {
      module: StatusModule,
      controllers: [StatusController],
      providers: [
        service
          ? {
              provide: STATUS_SERVICE,
              useValue: service,
            }
          : {
              provide: STATUS_SERVICE,
              useClass: DefaultStatusService,
            },
      ],
      exports: [STATUS_SERVICE],
    };
  }
}
