/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Global, Module, type DynamicModule } from '@nestjs/common';
import { SERVERS_SERVICE, ServersController, type IServersService } from './servers.controller.js';
import { DefaultServersService } from './servers.service.js';
import { HubTerminalService } from './terminal/service.js';

export { DefaultServersService, HubTerminalService, SERVERS_SERVICE, type IServersService };

@Global()
@Module({
  controllers: [ServersController],
  providers: [
    DefaultServersService,
    HubTerminalService,
    {
      provide: SERVERS_SERVICE,
      useExisting: DefaultServersService,
    },
  ],
  exports: [SERVERS_SERVICE, DefaultServersService, HubTerminalService],
})
export class ServersModule {
  static forRoot(service?: IServersService): DynamicModule {
    return {
      module: ServersModule,
      controllers: [ServersController],
      providers: [
        HubTerminalService,
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
      exports: [SERVERS_SERVICE, HubTerminalService],
    };
  }
}
