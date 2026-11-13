/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { CAMERA_SERVICE } from './tokens.js';
import type { CameraService } from './types.js';
import { CamerasController } from './camera.controller.js';
import { DefaultCameraService } from './camera.service.js';
import { CameraIntegrationService } from './integration.service.js';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import { CameraCatalog } from '../storage/cameras/catalog.js';
import { NativeProviders } from '../providers/native.js';
import { NativeCameraSources } from './control/sources.js';
import { NativeCameraControls } from './control/native.js';
import { NativeCameraRuntime } from './control/runtime.js';
import { IntegratedCameraSources } from './control/integrated.js';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home/home.service.js';
import { OrmIdentities } from '../storage/identity.js';
import { NativeGraph } from '../providers/graph/service.js';
import { NativeGraphIdentity } from '../providers/graph/identity.js';

@Module({
  controllers: [CamerasController],
  providers: [
    {
      provide: CameraCatalog,
      useFactory: async (transactions: Transactions): Promise<CameraCatalog> => {
        const catalog = new CameraCatalog(transactions);
        await catalog.initialize();
        return catalog;
      },
      inject: [CATALOG_TRANSACTIONS],
    },
    {
      provide: NativeProviders,
      useFactory: (catalog: CameraCatalog): NativeProviders => new NativeProviders({ catalog }),
      inject: [CameraCatalog],
    },
    {
      provide: NativeCameraSources,
      useFactory: (providers: NativeProviders, catalog: CameraCatalog): NativeCameraSources =>
        new NativeCameraSources({ providers, catalog }),
      inject: [NativeProviders, CameraCatalog],
    },
    {
      provide: NativeCameraControls,
      useFactory: (providers: NativeProviders, sources: NativeCameraSources) =>
        new NativeCameraControls(providers, sources),
      inject: [NativeProviders, NativeCameraSources],
    },
    {
      provide: NativeGraph,
      useFactory: (
        home: StandaloneHomeService | undefined,
        providers: NativeProviders,
        sources: NativeCameraSources,
        transactions: Transactions,
      ) =>
        home
          ? new NativeGraph(
              home,
              providers,
              sources,
              new NativeGraphIdentity(
                new OrmIdentities(transactions),
                () => home.listDevices(),
                process.env.HAUS_HOME_ID ?? 'home-default',
              ),
            )
          : undefined,
      inject: [
        { token: STANDALONE_HOME_SERVICE, optional: true },
        NativeProviders,
        NativeCameraSources,
        CATALOG_TRANSACTIONS,
      ],
    },
    NativeCameraRuntime,
    IntegratedCameraSources,
    {
      provide: CAMERA_SERVICE,
      useClass: DefaultCameraService,
    },
    CameraIntegrationService,
  ],
  exports: [
    CAMERA_SERVICE,
    CameraIntegrationService,
    CameraCatalog,
    NativeProviders,
    NativeCameraSources,
    NativeCameraControls,
    NativeCameraRuntime,
    IntegratedCameraSources,
    NativeGraph,
  ],
})
export class CamerasModule {
  static forRoot(customService?: CameraService): DynamicModule {
    return {
      module: CamerasModule,
      controllers: [CamerasController],
      providers: [
        {
          provide: CAMERA_SERVICE,
          useValue: customService ?? new DefaultCameraService(),
        },
      ],
      exports: [CAMERA_SERVICE],
    };
  }
}
