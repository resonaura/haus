/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { MqttServiceOptions } from './options.js';
import { MqttService } from './service.js';
import { HAUS_MQTT_OPTIONS, HAUS_MQTT_SERVICE } from './tokens.js';
import { HomeModule } from '../home/home.module.js';

@Global()
@Module({
  imports: [HomeModule],
  providers: [
    MqttService,
    {
      provide: HAUS_MQTT_SERVICE,
      useExisting: MqttService,
    },
  ],
  exports: [MqttService, HAUS_MQTT_SERVICE],
})
export class MqttModule {
  static forRoot(options?: MqttServiceOptions): DynamicModule {
    return {
      module: MqttModule,
      imports: [HomeModule],
      providers: [
        {
          provide: HAUS_MQTT_OPTIONS,
          useValue: options,
        },
        MqttService,
        {
          provide: HAUS_MQTT_SERVICE,
          useExisting: MqttService,
        },
      ],
      exports: [MqttService, HAUS_MQTT_SERVICE],
    };
  }
}
