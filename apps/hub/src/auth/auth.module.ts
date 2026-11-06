/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { HubAuthService } from './service.js';
import { HUB_AUTH_SERVICE } from './tokens.js';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: HUB_AUTH_SERVICE,
      useValue: undefined,
    },
  ],
  exports: [HUB_AUTH_SERVICE],
})
export class AuthModule {
  static forRoot(service?: HubAuthService): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        {
          provide: HUB_AUTH_SERVICE,
          useValue: service,
        },
      ],
      exports: [HUB_AUTH_SERVICE],
    };
  }
}
