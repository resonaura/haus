/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { ClusterController, CLUSTER_SERVICE, type IClusterService } from './cluster.controller.js';
import { DefaultClusterService } from './cluster.service.js';

export { CLUSTER_SERVICE, type IClusterService, DefaultClusterService };

@Module({
  controllers: [ClusterController],
  providers: [
    DefaultClusterService,
    {
      provide: CLUSTER_SERVICE,
      useExisting: DefaultClusterService,
    },
  ],
  exports: [CLUSTER_SERVICE, DefaultClusterService],
})
export class ClusterModule {
  static forRoot(service?: IClusterService): DynamicModule {
    return {
      module: ClusterModule,
      controllers: [ClusterController],
      providers: [
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
      exports: [CLUSTER_SERVICE],
    };
  }
}
