/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { Host, type HostOptions } from './host.js';

export const HOST_SERVICE = 'HOST_SERVICE';

@Module({})
export class HostModule implements OnModuleDestroy {
  private static activeHost?: Host;

  static forRoot(options: HostOptions): DynamicModule {
    const hostProvider = {
      provide: HOST_SERVICE,
      useFactory: async (): Promise<Host> => {
        const host = await Host.open(options);
        HostModule.activeHost = host;
        return host;
      },
    };

    return {
      module: HostModule,
      global: true,
      providers: [hostProvider],
      exports: [HOST_SERVICE],
    };
  }

  static fromInstance(host: Host): DynamicModule {
    HostModule.activeHost = host;
    return {
      module: HostModule,
      global: true,
      providers: [
        {
          provide: HOST_SERVICE,
          useValue: host,
        },
      ],
      exports: [HOST_SERVICE],
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (HostModule.activeHost) {
      await HostModule.activeHost.close();
      HostModule.activeHost = undefined;
    }
  }
}
