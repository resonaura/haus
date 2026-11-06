/*
 * Haus — A thoughtful home for Home Assistant.
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

@Module({
  controllers: [CamerasController],
  providers: [
    {
      provide: CAMERA_SERVICE,
      useClass: DefaultCameraService,
    },
  ],
  exports: [CAMERA_SERVICE],
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
