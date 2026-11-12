/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { HaCameras } from '@haus/ha/node/ha-cameras';
import type { NativeEntities } from '@haus/ha/node/native-entities';
import type { HaCatalog } from '../storage/ha/catalog.js';
import type { IHaCamerasService } from './ha.controller.js';
import type { HaCameraItemDto, HaEnrollDto, HaIntegrationSetupDto } from './ha.dto.js';
import { HA_CAMERAS, HA_CATALOG, NATIVE_ENTITIES } from './tokens.js';

@Injectable()
export class DefaultHaCamerasService implements IHaCamerasService {
  private readonly fallbackClients = new Map<string, string>();
  private configuredUrl?: string;

  constructor(
    @Optional() @Inject(HA_CATALOG) private readonly catalog?: HaCatalog,
    @Optional() @Inject(NATIVE_ENTITIES) private readonly nativeEntities?: NativeEntities,
    @Optional() @Inject(HA_CAMERAS) private readonly haCameras?: HaCameras,
  ) {}

  async setup(input: HaIntegrationSetupDto): Promise<unknown> {
    if (this.haCameras) {
      if (input.action === 'setup') {
        const payload: { action: 'setup'; nativeEntities?: boolean } = { action: 'setup' };
        if (input.nativeEntities !== undefined) {
          payload.nativeEntities = Boolean(input.nativeEntities);
        }
        return this.haCameras.setup(payload);
      }
      if (input.action === 'revoke' && input.clientId) {
        return this.haCameras.setup({ action: 'revoke', clientId: input.clientId });
      }
    }
    this.configuredUrl = input.url;
    return { configured: true, url: this.configuredUrl };
  }

  async enroll(input: unknown): Promise<unknown> {
    if (this.haCameras) {
      if (
        input &&
        typeof input === 'object' &&
        'code' in input &&
        typeof (input as HaEnrollDto).code === 'string'
      ) {
        return this.haCameras.enroll({ code: (input as HaEnrollDto).code! });
      }
    }
    const token = randomBytes(24).toString('hex');
    const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const clientId =
      typeof record.clientId === 'string'
        ? record.clientId
        : `ha-${randomBytes(6).toString('hex')}`;
    this.fallbackClients.set(token, clientId);
    return { enrolled: true, clientId, token };
  }

  async revoke(clientId: string): Promise<unknown> {
    if (this.haCameras) {
      return this.haCameras.revoke(clientId);
    }
    for (const [token, id] of this.fallbackClients.entries()) {
      if (id === clientId) {
        this.fallbackClients.delete(token);
      }
    }
    return { revoked: true, clientId };
  }

  authenticate(
    authHeader?: string,
    context?: { method?: string; url?: string },
  ): string | undefined {
    if (!authHeader) return undefined;
    if (this.haCameras) {
      const auth = this.haCameras.authenticate({
        headers: { authorization: authHeader },
        method: context?.method ?? 'GET',
        url: context?.url ?? '',
      });
      if (auth) return auth;
    }
    if (!authHeader.startsWith('Bearer ')) return undefined;
    const token = authHeader.slice(7).trim();
    return this.fallbackClients.get(token);
  }

  canManageNative(clientId: string): boolean {
    if (this.catalog) {
      return this.catalog.canManageNative(clientId);
    }
    return false;
  }

  cameras(): HaCameraItemDto[] {
    if (this.haCameras) {
      return this.haCameras.cameras() as unknown as HaCameraItemDto[];
    }
    return [];
  }

  async snapshot(
    id: string,
    clientId = '',
  ): Promise<{ buffer: Buffer; mime: string; at: number; stale: boolean }> {
    if (this.haCameras) {
      return (await this.haCameras.command(clientId, id, 'snapshot', {})) as {
        buffer: Buffer;
        mime: string;
        at: number;
        stale: boolean;
      };
    }
    return {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mime: 'image/jpeg',
      at: Date.now(),
      stale: false,
    };
  }

  async command(clientId: string, camera: string, action: string, payload: unknown) {
    if (this.haCameras) {
      return this.haCameras.command(
        clientId,
        camera,
        action,
        payload as Parameters<HaCameras['command']>[3],
      );
    }
    return { clientId, camera, action, status: 'accepted' };
  }

  nativeDevices(): unknown[] {
    if (this.nativeEntities) {
      return this.nativeEntities.devices();
    }
    return [];
  }

  async nativeCommand(camera: string, entity: string, payload: unknown) {
    if (this.nativeEntities) {
      return this.nativeEntities.command(
        camera,
        entity,
        payload as Parameters<NativeEntities['command']>[2],
      );
    }
    return { camera, entity, status: 'dispatched' };
  }

  async nativeAcknowledge(clientId: string, payload: unknown) {
    if (this.nativeEntities) {
      return await this.nativeEntities.acknowledge(
        clientId,
        payload as Parameters<NativeEntities['acknowledge']>[1],
      );
    }
    return { acknowledged: true, clientId };
  }
}
