/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { DocsModule } from './docs/docs.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ControlModule } from './control/control.module.js';
import { PreferencesModule } from './preferences/preferences.module.js';
import { ServersModule } from './servers/servers.module.js';
import { ClusterModule } from './cluster/cluster.module.js';
import { BackupsModule } from './backup/backups.module.js';
import { StatusModule } from './status/status.module.js';
import { isExplicitHaAppliance } from './status/status.service.js';
import { KitsuneModule } from './kitsune/kitsune.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { HaCamerasModule } from './ha/ha.module.js';
import { CamerasModule } from './camera/camera.module.js';
import { StreamModule } from './stream/stream.module.js';
import { EventsModule } from './events/events.module.js';
import { RecordingModule } from './events/recording.module.js';
import { LiveModule } from './live/live.module.js';
import { HomeModule } from './home/home.module.js';
import { MqttModule } from './mqtt/mqtt.module.js';
import { MatterModule } from './matter/matter.module.js';
import { StatsModule } from './stats/stats.module.js';
import { StorageModule } from './storage/storage.module.js';
import { join } from 'node:path';

export interface AppModuleOptions {
  appliance?: string;
  apiToken?: string;
  mediaDirectory?: string;
}

@Module({
  imports: [
    HealthModule,
    DocsModule,
    AuthModule,
    ControlModule,
    PreferencesModule,
    ServersModule,
    ClusterModule,
    BackupsModule,
    StatusModule,
    KitsuneModule,
    ProvidersModule,
    CamerasModule,
    StreamModule,
    EventsModule,
    LiveModule,
    HomeModule,
    MqttModule,
    MatterModule,
  ],
})
export class AppModule {
  static forRoot(dataDirectory: string, options?: AppModuleOptions): DynamicModule {
    const haAppliance = isExplicitHaAppliance(options?.appliance);
    return {
      module: AppModule,
      imports: [
        HealthModule.forRoot(haAppliance ? 'ha-appliance' : 'standalone'),
        ...(options?.apiToken ? [AuthModule.forRoot({ apiToken: options.apiToken })] : []),
        ...(haAppliance ? [HaCamerasModule] : []),
        StorageModule.forRoot({ databasePath: join(dataDirectory, 'haus.sqlite') }),
        RecordingModule.forRoot(options?.mediaDirectory ?? join(dataDirectory, 'media')),
        StatsModule.forRoot({ dbPath: join(dataDirectory, 'hub-stats.sqlite') }),
      ],
    };
  }
}
