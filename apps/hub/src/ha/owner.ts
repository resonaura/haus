/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { NativeEntities } from '@haus/ha/node/native-entities';
import type { ActivityMqtt } from '@haus/ha/node/activity-mqtt';
import { ACTIVITY_MQTT, NATIVE_ENTITIES } from './tokens.js';

const TICK_INTERVAL_MS = 4000;

@Injectable()
export class HaApplianceOwner implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private releaseTick?: Promise<void>;

  constructor(
    @Optional() @Inject(NATIVE_ENTITIES) private readonly nativeEntities?: NativeEntities,
    @Optional() @Inject(ACTIVITY_MQTT) private readonly activityMqtt?: ActivityMqtt,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    if (this.activityMqtt) {
      void this.activityMqtt.tick().catch(() => {});
    }
    if (this.nativeEntities && !this.releaseTick) {
      this.releaseTick = this.nativeEntities
        .tick()
        .catch(() => {})
        .finally(() => {
          this.releaseTick = undefined;
        });
    }
  }
}
