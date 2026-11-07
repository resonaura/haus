/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable, Module, type DynamicModule } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { HaController, HA_CAMERAS_SERVICE, type IHaCamerasService } from './ha.controller.js';
import type { HaCameraItemDto, HaIntegrationSetupDto } from './ha.dto.js';

export { HA_CAMERAS_SERVICE, type IHaCamerasService };

@Injectable()
export class DefaultHaCamerasService implements IHaCamerasService {
  private readonly clients = new Map<string, string>();
  private configuredUrl?: string;

  setup(input: HaIntegrationSetupDto) {
    this.configuredUrl = input.url;
    return { configured: true, url: this.configuredUrl };
  }

  enroll(input: unknown) {
    const token = randomBytes(24).toString('hex');
    const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const clientId =
      typeof record.clientId === 'string'
        ? record.clientId
        : `ha-${randomBytes(6).toString('hex')}`;
    this.clients.set(token, clientId);
    return { enrolled: true, clientId, token };
  }

  revoke(clientId: string) {
    for (const [token, id] of this.clients.entries()) {
      if (id === clientId) {
        this.clients.delete(token);
      }
    }
    return { revoked: true, clientId };
  }

  authenticate(authHeader?: string): string | undefined {
    if (!authHeader?.startsWith('Bearer ')) return undefined;
    const token = authHeader.slice(7).trim();
    return this.clients.get(token);
  }

  cameras(): HaCameraItemDto[] {
    return [];
  }

  async snapshot(_id: string) {
    return {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mime: 'image/jpeg',
      at: Date.now(),
      stale: false,
    };
  }

  async command(clientId: string, camera: string, action: string, _payload: unknown) {
    return { clientId, camera, action, status: 'accepted' };
  }

  nativeDevices(): unknown[] {
    return [];
  }

  async nativeCommand(camera: string, entity: string, _payload: unknown) {
    return { camera, entity, status: 'dispatched' };
  }

  nativeAcknowledge(clientId: string, _payload: unknown) {
    return { acknowledged: true, clientId };
  }
}

@Module({
  controllers: [HaController],
  providers: [
    DefaultHaCamerasService,
    {
      provide: HA_CAMERAS_SERVICE,
      useExisting: DefaultHaCamerasService,
    },
  ],
  exports: [HA_CAMERAS_SERVICE],
})
export class HaCamerasModule {
  static forRoot(service?: IHaCamerasService): DynamicModule {
    return {
      module: HaCamerasModule,
      controllers: [HaController],
      providers: service
        ? [
            {
              provide: HA_CAMERAS_SERVICE,
              useValue: service,
            },
          ]
        : [
            DefaultHaCamerasService,
            {
              provide: HA_CAMERAS_SERVICE,
              useExisting: DefaultHaCamerasService,
            },
          ],
      exports: [HA_CAMERAS_SERVICE],
    };
  }
}
