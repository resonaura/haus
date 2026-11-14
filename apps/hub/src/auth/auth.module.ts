/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  Global,
  Inject,
  Module,
  Optional,
  type DynamicModule,
  type OnModuleInit,
} from '@nestjs/common';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { HubAuthService, type HubAuthConfig } from './service.js';
import { HUB_AUTH_SERVICE } from './tokens.js';

function readSecretFile(filePath: string | undefined): string | undefined {
  const cleanPath = filePath?.trim();
  if (!cleanPath) return undefined;
  try {
    if (!existsSync(cleanPath)) return undefined;
    const raw = readFileSync(cleanPath, 'utf8').trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

function createDefaultAuthService(
  config?: HubAuthConfig,
  transactions?: Transactions,
): HubAuthService {
  const apiToken =
    config?.apiToken ??
    process.env.HAUS_API_TOKEN ??
    readSecretFile(process.env.HAUS_API_TOKEN_FILE);
  const defaultPort = process.env.PORT?.trim() || '8790';
  return new HubAuthService({
    hubId: config?.hubId ?? process.env.HAUS_HUB_ID ?? 'hub-standalone-01',
    homeId: config?.homeId ?? process.env.HAUS_HOME_ID ?? 'home-default',
    hubName: config?.hubName ?? process.env.HAUS_HUB_NAME ?? 'Haus Hub',
    hubUrl:
      config?.hubUrl ??
      process.env.HAUS_HUB_URL ??
      process.env.HAUS_PUBLIC_URL ??
      `http://127.0.0.1:${defaultPort}`,
    apiToken,
    sessionTtlMs: config?.sessionTtlMs,
    now: config?.now,
    tokenGenerator: config?.tokenGenerator,
    transactions: config?.transactions ?? transactions,
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
      useFactory: (transactions?: Transactions) =>
        createDefaultAuthService(undefined, transactions),
      inject: [{ token: CATALOG_TRANSACTIONS, optional: true }],
    },
    AuthGuard,
  ],
  exports: [HUB_AUTH_SERVICE, AuthGuard],
})
export class AuthModule implements OnModuleInit {
  constructor(
    @Optional()
    @Inject(HUB_AUTH_SERVICE)
    private readonly authService?: HubAuthService,
    @Optional()
    @Inject(CATALOG_TRANSACTIONS)
    private readonly transactions?: Transactions,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.authService) return;
    if (typeof this.authService.attachTransactions === 'function' && this.transactions) {
      this.authService.attachTransactions(this.transactions);
    }
    if (typeof this.authService.loadPersistedSessions === 'function') {
      await this.authService.loadPersistedSessions();
    }
  }

  static forRoot(serviceOrConfig?: HubAuthService | HubAuthConfig): DynamicModule {
    if (isHubAuthService(serviceOrConfig)) {
      return {
        global: true,
        module: AuthModule,
        controllers: [AuthController],
        providers: [
          {
            provide: HUB_AUTH_SERVICE,
            useValue: serviceOrConfig,
          },
          AuthGuard,
        ],
        exports: [HUB_AUTH_SERVICE, AuthGuard],
      };
    }

    return {
      global: true,
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        {
          provide: HUB_AUTH_SERVICE,
          useFactory: (transactions?: Transactions) =>
            createDefaultAuthService(serviceOrConfig, transactions),
          inject: [{ token: CATALOG_TRANSACTIONS, optional: true }],
        },
        AuthGuard,
      ],
      exports: [HUB_AUTH_SERVICE, AuthGuard],
    };
  }
}
