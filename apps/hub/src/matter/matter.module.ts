/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { MatterWsTransportOptions } from '@haus/matter';
import { MatterService } from './service.js';
import { HAUS_MATTER_OPTIONS, HAUS_MATTER_SERVICE } from './tokens.js';

@Global()
@Module({
  providers: [
    MatterService,
    {
      provide: HAUS_MATTER_SERVICE,
      useExisting: MatterService,
    },
  ],
  exports: [MatterService, HAUS_MATTER_SERVICE],
})
export class MatterModule {
  static forRoot(options?: MatterWsTransportOptions): DynamicModule {
    return {
      module: MatterModule,
      global: true,
      providers: [
        {
          provide: HAUS_MATTER_OPTIONS,
          useValue: options,
        },
        MatterService,
        {
          provide: HAUS_MATTER_SERVICE,
          useExisting: MatterService,
        },
      ],
      exports: [MatterService, HAUS_MATTER_SERVICE],
    };
  }
}
