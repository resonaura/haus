/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import {
  ProvidersController,
  PROVIDERS_SERVICE,
  type IProvidersService,
} from './providers.controller.js';
import { CamerasModule } from '../camera/camera.module.js';
import { NativeCameraSources } from '../camera/control/sources.js';
import { NativeProviders } from './native.js';
import { NativeProviderService } from './service.js';
import { AppAccessories } from './accessories.js';
import { AppAccessoriesController } from './apps.controller.js';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home/home.service.js';
import { NativeGraph } from './graph/service.js';
import { NATIVE_ENTITIES, NATIVE_MIGRATION } from '../ha/tokens.js';
import type { NativeEntities } from '@haus/ha/node/native-entities';
import type { NativeMigration } from '@haus/ha/node/native-migration';

export { PROVIDERS_SERVICE, type IProvidersService };

@Module({
  controllers: [ProvidersController],
  providers: [
    {
      provide: PROVIDERS_SERVICE,
      useValue: undefined,
    },
  ],
  exports: [PROVIDERS_SERVICE],
})
export class ProvidersModule {
  static forRoot(service?: IProvidersService): DynamicModule {
    return {
      module: ProvidersModule,
      controllers: service
        ? [ProvidersController]
        : [ProvidersController, AppAccessoriesController],
      imports: service ? [] : [CamerasModule],
      providers: service
        ? [{ provide: PROVIDERS_SERVICE, useValue: service }]
        : [
            {
              provide: AppAccessories,
              useFactory: (
                home: StandaloneHomeService,
                providers: NativeProviders,
                sources: NativeCameraSources,
                graph: NativeGraph,
              ) =>
                new AppAccessories(
                  home,
                  providers,
                  sources,
                  () => {
                    const registry = graph.registry();
                    return { ...registry, cameras: sources.merge(registry) };
                  },
                  undefined,
                  undefined,
                  graph,
                ),
              inject: [STANDALONE_HOME_SERVICE, NativeProviders, NativeCameraSources, NativeGraph],
            },
            {
              provide: PROVIDERS_SERVICE,
              useFactory: (
                providers: NativeProviders,
                sources: NativeCameraSources,
                graph: NativeGraph,
                nativeEntities?: NativeEntities,
                nativeMigration?: NativeMigration,
              ) =>
                new NativeProviderService(
                  providers,
                  sources,
                  undefined,
                  graph,
                  nativeEntities,
                  nativeMigration,
                ),
              inject: [
                NativeProviders,
                NativeCameraSources,
                NativeGraph,
                { token: NATIVE_ENTITIES, optional: true },
                { token: NATIVE_MIGRATION, optional: true },
              ],
            },
          ],
      exports: [PROVIDERS_SERVICE],
    };
  }
}
