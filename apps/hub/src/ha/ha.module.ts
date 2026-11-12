/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { HaCameras, type HaCamerasRegistry } from '@haus/ha/node/ha-cameras';
import { NativeEntities } from '@haus/ha/node/native-entities';
import { NativeMigration } from '@haus/ha/node/native-migration';
import { nativeMigrationDocuments } from '@haus/ha/node/native-migration-documents';
import { ActivityMqtt } from '@haus/ha/node/activity-mqtt';
import { HaCatalog } from '../storage/ha/catalog.js';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import { CatalogLifetime } from '../storage/lifetime.js';
import type { Transactions } from '../storage/transactions.js';
import { CamerasModule } from '../camera/camera.module.js';
import { NativeCameraSources } from '../camera/control/sources.js';
import { NativeProviders } from '../providers/native.js';
import { NativeGraph } from '../providers/graph/service.js';
import { CameraSnapshots } from '../camera/control/snapshots.js';
import { CameraActivity } from '../camera/control/activity.js';
import { NvrCameraSessions } from '../camera/sessions/sessions.js';
import { RECORDING_BACKUPS, RECORDING_SESSIONS } from '../events/tokens.js';
import type { Backups } from '../backup/backups.js';
import { StandaloneHaClient } from './client.js';
import { HaController, HA_CAMERAS_SERVICE, type IHaCamerasService } from './ha.controller.js';
import { DefaultHaCamerasService } from './service.js';
import { HaApplianceOwner } from './owner.js';
import {
  ACTIVITY_MQTT,
  HA_CAMERAS,
  HA_CATALOG,
  NATIVE_ENTITIES,
  NATIVE_MIGRATION,
} from './tokens.js';

export {
  HA_CAMERAS_SERVICE,
  HA_CATALOG,
  NATIVE_ENTITIES,
  NATIVE_MIGRATION,
  ACTIVITY_MQTT,
  HA_CAMERAS,
  type IHaCamerasService,
};

@Module({
  controllers: [HaController],
  providers: [
    {
      provide: HA_CAMERAS_SERVICE,
      useValue: undefined,
    },
  ],
  exports: [HA_CAMERAS_SERVICE],
})
export class HaCamerasModule {
  static forRoot(service?: IHaCamerasService): DynamicModule {
    if (service) {
      return {
        module: HaCamerasModule,
        controllers: [HaController],
        providers: [
          {
            provide: HA_CAMERAS_SERVICE,
            useValue: service,
          },
        ],
        exports: [HA_CAMERAS_SERVICE],
      };
    }
    return {
      module: HaCamerasModule,
      global: true,
      imports: [CamerasModule],
      controllers: [HaController],
      providers: [
        {
          provide: HA_CATALOG,
          inject: [CATALOG_TRANSACTIONS],
          useFactory: async (transactions: Transactions): Promise<HaCatalog> => {
            const catalog = new HaCatalog(transactions);
            await catalog.initialize();
            return catalog;
          },
        },
        {
          provide: NATIVE_ENTITIES,
          inject: [HA_CATALOG, NativeCameraSources, NativeProviders, NativeGraph, CameraActivity],
          useFactory: (
            catalog: HaCatalog,
            sources: NativeCameraSources,
            providers: NativeProviders,
            graph: NativeGraph,
            activity: CameraActivity,
          ): NativeEntities => {
            const registry = () => {
              const reg = graph.registry();
              return { ...reg, cameras: sources.merge(reg) };
            };
            return new NativeEntities({
              catalog,
              sources: sources as ConstructorParameters<typeof NativeEntities>[0]['sources'],
              providers: providers as ConstructorParameters<typeof NativeEntities>[0]['providers'],
              registry,
              activity: activity as ConstructorParameters<typeof NativeEntities>[0]['activity'],
            });
          },
        },
        {
          provide: NATIVE_MIGRATION,
          inject: [
            HA_CATALOG,
            StandaloneHaClient,
            NativeProviders,
            NativeCameraSources,
            NATIVE_ENTITIES,
            RECORDING_BACKUPS,
            NativeGraph,
            CatalogLifetime,
          ],
          useFactory: async (
            catalog: HaCatalog,
            ha: StandaloneHaClient,
            providers: NativeProviders,
            sources: NativeCameraSources,
            native: NativeEntities,
            backups: Backups,
            graph: NativeGraph,
            lifetime: CatalogLifetime,
          ): Promise<NativeMigration> => {
            const registry = () => {
              const reg = graph.registry();
              return { ...reg, cameras: sources.merge(reg) };
            };
            const migration = new NativeMigration({
              catalog,
              ha: ha as ConstructorParameters<typeof NativeMigration>[0]['ha'],
              providers: providers as ConstructorParameters<typeof NativeMigration>[0]['providers'],
              sources: sources as ConstructorParameters<typeof NativeMigration>[0]['sources'],
              native,
              documents: (reg) =>
                nativeMigrationDocuments(
                  ha as Parameters<typeof nativeMigrationDocuments>[0],
                  {
                    states:
                      (
                        registry() as {
                          states?: Array<{ entity_id: string; attributes?: { id?: unknown } }>;
                        }
                      ).states ?? [],
                    entities: reg.entities,
                  },
                  () => migration.closed,
                ),
              onChanged: () => backups.markChanged(),
            });
            await migration.ready;
            lifetime.defer(() => migration.stop());
            return migration;
          },
        },
        {
          provide: ACTIVITY_MQTT,
          inject: [
            StandaloneHaClient,
            CameraActivity,
            NativeGraph,
            NativeCameraSources,
            NATIVE_ENTITIES,
            CatalogLifetime,
          ],
          useFactory: (
            ha: StandaloneHaClient,
            activity: CameraActivity,
            graph: NativeGraph,
            sources: NativeCameraSources,
            native: NativeEntities,
            lifetime: CatalogLifetime,
          ): ActivityMqtt => {
            const registry = () => {
              const reg = graph.registry();
              const cameras = sources.merge(reg);
              return {
                cameras: cameras.map((c) => ({
                  id: c.id,
                  name: c.name ?? c.id,
                  areaId: c.areaId ?? null,
                })),
              };
            };
            const mqtt = new ActivityMqtt({
              ha,
              activity,
              registry,
              nativeOwned: (id) => Boolean(native.ownsActivity(id)),
            });
            if (typeof (ha as unknown as { on?: unknown }).on === 'function') {
              (ha as unknown as { on: (event: string, fn: () => void) => void }).on('ready', () =>
                mqtt.reset(),
              );
            }
            lifetime.defer(() => mqtt.stop());
            return mqtt;
          },
        },
        {
          provide: HA_CAMERAS,
          inject: [
            HA_CATALOG,
            NativeGraph,
            NativeCameraSources,
            CameraSnapshots,
            RECORDING_SESSIONS,
            NATIVE_ENTITIES,
            CatalogLifetime,
          ],
          useFactory: (
            catalog: HaCatalog,
            graph: NativeGraph,
            sources: NativeCameraSources,
            snapshots: CameraSnapshots,
            sessions: NvrCameraSessions,
            native: NativeEntities,
            lifetime: CatalogLifetime,
          ): HaCameras => {
            const registry = () => {
              const reg = graph.registry();
              return { ...reg, cameras: sources.merge(reg) };
            };
            const haCameras = new HaCameras({
              catalog,
              registry: registry as unknown as () => HaCamerasRegistry,
              snapshots: snapshots as ConstructorParameters<typeof HaCameras>[0]['snapshots'],
              sessions: sessions as ConstructorParameters<typeof HaCameras>[0]['sessions'],
              onRevoke: (id) => native.revokeClient(id),
            });
            lifetime.defer(() => haCameras.stop());
            return haCameras;
          },
        },
        DefaultHaCamerasService,
        {
          provide: HA_CAMERAS_SERVICE,
          useExisting: DefaultHaCamerasService,
        },
        HaApplianceOwner,
      ],
      exports: [
        HA_CAMERAS_SERVICE,
        HA_CATALOG,
        NATIVE_ENTITIES,
        NATIVE_MIGRATION,
        ACTIVITY_MQTT,
        HA_CAMERAS,
      ],
    };
  }
}
