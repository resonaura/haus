/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { ServersController, SERVERS_SERVICE, type IServersService } from './servers.controller.js';
import { DefaultServersService } from './servers.service.js';

export { SERVERS_SERVICE, type IServersService, DefaultServersService };

@Module({
  controllers: [ServersController],
  providers: [
    DefaultServersService,
    {
      provide: SERVERS_SERVICE,
      useExisting: DefaultServersService,
    },
  ],
  exports: [SERVERS_SERVICE, DefaultServersService],
})
export class ServersModule {
  static forRoot(service?: IServersService): DynamicModule {
    return {
      module: ServersModule,
      controllers: [ServersController],
      providers: [
        service
          ? {
              provide: SERVERS_SERVICE,
              useValue: service,
            }
          : {
              provide: SERVERS_SERVICE,
              useClass: DefaultServersService,
            },
      ],
      exports: [SERVERS_SERVICE],
    };
  }
}
