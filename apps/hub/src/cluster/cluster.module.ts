/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ClusterController, CLUSTER_SERVICE, type IClusterService } from './cluster.controller.js';
import { DefaultClusterService } from './cluster.service.js';
import { ClusterTransferManager, CLUSTER_TRANSFER_MANAGER } from './transfer.js';
import { ClusterFencingGuard } from './fencing.guard.js';
import { ClusterPeerController } from './peer.controller.js';
import { ClusterPeerGuard } from './peer.guard.js';
import { ClusterStateStore } from './coordination/state.js';
import { ClusterLeaseService } from './coordination/leases.js';
import { ClusterReconciliationService } from './coordination/reconcile.js';
import { ClusterOrchestrator } from './coordination/orchestrator.js';
import { ClusterSyncService } from './sync/service.js';
import { ClusterDrainService } from './drain/service.js';

export {
  CLUSTER_SERVICE,
  type IClusterService,
  DefaultClusterService,
  ClusterTransferManager,
  CLUSTER_TRANSFER_MANAGER,
  ClusterFencingGuard,
  ClusterPeerGuard,
  ClusterPeerController,
  ClusterStateStore,
  ClusterLeaseService,
  ClusterReconciliationService,
  ClusterOrchestrator,
  ClusterSyncService,
  ClusterDrainService,
};

const COORDINATION_PROVIDERS = [
  ClusterStateStore,
  ClusterLeaseService,
  ClusterReconciliationService,
  ClusterSyncService,
  ClusterDrainService,
  ClusterOrchestrator,
  ClusterPeerGuard,
];

@Global()
@Module({
  controllers: [ClusterController, ClusterPeerController],
  providers: [
    ...COORDINATION_PROVIDERS,
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
    ...COORDINATION_PROVIDERS,
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
      controllers: [ClusterController, ClusterPeerController],
      providers: [
        ...COORDINATION_PROVIDERS,
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
        ...COORDINATION_PROVIDERS,
        CLUSTER_SERVICE,
        CLUSTER_TRANSFER_MANAGER,
        ClusterTransferManager,
        ClusterFencingGuard,
      ],
    };
  }
}
