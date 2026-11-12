/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { ClusterController, CLUSTER_SERVICE, type IClusterService } from './cluster.controller.js';
import { DefaultClusterService } from './cluster.service.js';
import { ClusterTransferManager, CLUSTER_TRANSFER_MANAGER } from './transfer.js';
import { ClusterFencingGuard } from './fencing.guard.js';

export {
  CLUSTER_SERVICE,
  type IClusterService,
  DefaultClusterService,
  ClusterTransferManager,
  CLUSTER_TRANSFER_MANAGER,
  ClusterFencingGuard,
};

@Global()
@Module({
  imports: [AuthModule],
  controllers: [ClusterController],
  providers: [
    DefaultClusterService,
    {
      provide: CLUSTER_SERVICE,
      useExisting: DefaultClusterService,
    },
    ClusterTransferManager,
    {
      provide: CLUSTER_TRANSFER_MANAGER,
      useExisting: ClusterTransferManager,
    },
    ClusterFencingGuard,
    {
      provide: APP_GUARD,
      useClass: ClusterFencingGuard,
    },
  ],
  exports: [
    CLUSTER_SERVICE,
    DefaultClusterService,
    CLUSTER_TRANSFER_MANAGER,
    ClusterTransferManager,
    ClusterFencingGuard,
  ],
})
export class ClusterModule {
  static forRoot(service?: IClusterService): DynamicModule {
    return {
      module: ClusterModule,
      controllers: [ClusterController],
      providers: [
        ClusterTransferManager,
        {
          provide: CLUSTER_TRANSFER_MANAGER,
          useExisting: ClusterTransferManager,
        },
        ClusterFencingGuard,
        {
          provide: APP_GUARD,
          useClass: ClusterFencingGuard,
        },
        service
          ? {
              provide: CLUSTER_SERVICE,
              useValue: service,
            }
          : {
              provide: CLUSTER_SERVICE,
              useClass: DefaultClusterService,
            },
      ],
      exports: [
        CLUSTER_SERVICE,
        CLUSTER_TRANSFER_MANAGER,
        ClusterTransferManager,
        ClusterFencingGuard,
      ],
    };
  }
}
