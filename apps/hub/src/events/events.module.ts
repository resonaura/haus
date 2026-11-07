/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { EVENTS_SERVICE } from './tokens.js';
import type { EventsService } from './types.js';
import { EventsController } from './events.controller.js';
import { DefaultEventsService } from './events.service.js';

@Module({
  controllers: [EventsController],
  providers: [
    {
      provide: EVENTS_SERVICE,
      useClass: DefaultEventsService,
    },
  ],
  exports: [EVENTS_SERVICE],
})
export class EventsModule {
  static forRoot(customService?: EventsService): DynamicModule {
    return {
      module: EventsModule,
      controllers: [EventsController],
      providers: [
        {
          provide: EVENTS_SERVICE,
          useValue: customService ?? new DefaultEventsService(),
        },
      ],
      exports: [EVENTS_SERVICE],
    };
  }
}
