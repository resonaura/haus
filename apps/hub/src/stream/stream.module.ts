/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { STREAM_SERVICE } from './tokens.js';
import type { StreamService } from './types.js';
import { StreamController } from './stream.controller.js';
import { DefaultStreamService } from './stream.service.js';
import { CamerasModule } from '../camera/camera.module.js';

@Module({
  imports: [CamerasModule],
  controllers: [StreamController],
  providers: [
    {
      provide: STREAM_SERVICE,
      useClass: DefaultStreamService,
    },
  ],
  exports: [STREAM_SERVICE],
})
export class StreamModule {
  static forRoot(customService?: StreamService): DynamicModule {
    return {
      module: StreamModule,
      controllers: [StreamController],
      providers: [
        {
          provide: STREAM_SERVICE,
          useValue: customService ?? new DefaultStreamService(),
        },
      ],
      exports: [STREAM_SERVICE],
    };
  }
}
