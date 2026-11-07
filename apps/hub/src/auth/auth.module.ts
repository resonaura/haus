/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { HubAuthService, type HubAuthConfig } from './service.js';
import { HUB_AUTH_SERVICE } from './tokens.js';

function createDefaultAuthService(config?: HubAuthConfig): HubAuthService {
  return new HubAuthService({
    hubId: config?.hubId ?? process.env.HAUS_HUB_ID ?? 'hub-standalone-01',
    homeId: config?.homeId ?? process.env.HAUS_HOME_ID ?? 'home-default',
    hubName: config?.hubName ?? process.env.HAUS_HUB_NAME ?? 'Haus Hub',
    hubUrl: config?.hubUrl ?? process.env.HAUS_HUB_URL ?? 'http://127.0.0.1:8124',
    apiToken: config?.apiToken ?? process.env.HAUS_API_TOKEN,
    sessionTtlMs: config?.sessionTtlMs,
    now: config?.now,
    tokenGenerator: config?.tokenGenerator,
  });
}

function isHubAuthService(
  serviceOrConfig: HubAuthService | HubAuthConfig | undefined,
): serviceOrConfig is HubAuthService {
  return (
    serviceOrConfig instanceof HubAuthService ||
    Boolean(
      serviceOrConfig &&
      typeof serviceOrConfig === 'object' &&
      'pair' in serviceOrConfig &&
      typeof serviceOrConfig.pair === 'function',
    )
  );
}

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: HUB_AUTH_SERVICE,
      useFactory: () => createDefaultAuthService(),
    },
    AuthGuard,
  ],
  exports: [HUB_AUTH_SERVICE, AuthGuard],
})
export class AuthModule {
  static forRoot(serviceOrConfig?: HubAuthService | HubAuthConfig): DynamicModule {
    const service = isHubAuthService(serviceOrConfig)
      ? serviceOrConfig
      : createDefaultAuthService(serviceOrConfig);
    return {
      global: true,
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        {
          provide: HUB_AUTH_SERVICE,
          useValue: service,
        },
        AuthGuard,
      ],
      exports: [HUB_AUTH_SERVICE, AuthGuard],
    };
  }
}
