/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { CameraBridgeClient } from '@haus/bridge/client';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  NativeProviders,
  type NativeBridgeClientPort,
  type NativeProviderConnection,
  type NativeProviderInventory,
} from '../../src/providers/native.js';
import { CameraCatalog, openCatalog, Transactions } from '../../src/storage/index.js';

async function openTestCameraCatalog(database = ':memory:') {
  const source = await openCatalog(database);
  const transactions = new Transactions(source);
  const cameraCatalog = new CameraCatalog(transactions);
  await cameraCatalog.initialize();
  return {
    cameraCatalog,
    close: async () => {
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
    },
  };
}

describe('NativeProviders', () => {
  it('dispatches an available stream control without requiring a live video frame', async () => {
    const owner = await openTestCameraCatalog();
    const id = randomUUID();
    const connection = {
      bridgeId: id,
      provider: 'aqara' as const,
      clientId: randomUUID(),
      token: 'a'.repeat(64),
      endpoint: {
        url: 'http://192.168.1.20:8580',
        address: '192.168.1.20',
        family: 4 as const,
        allowHttp: true,
      },
    };
    const entity = {
      id: 'p2p_stream',
      name: 'Stream',
      domain: 'switch' as const,
      writable: true,
      available: true,
      state: false,
      updatedAt: 1000,
    };
    const inventory: NativeProviderInventory = {
      version: 2,
      bridgeId: id,
      provider: 'aqara',
      revision: 'b'.repeat(64),
      cameras: [
        {
          id: 'physical-one',
          name: 'One',
          manufacturer: 'Aqara',
          model: 'E1',
          available: false,
          identifiers: ['one'],
          stream: { url: 'rtsp://192.168.1.20:8554/one', transport: 'p2p' },
          entities: [entity],
        },
      ],
    };
    const request = vi.fn(async () => ({ accepted: true }));
    const transport = new CameraBridgeClient(connection, request);
    const command = vi.fn(transport.command.bind(transport));
    const client = {
      connection,
      inventory: async () => structuredClone(inventory),
      revoke: async () => ({}),
      command,
    };
    const manager = new NativeProviders({
      catalog: owner.cameraCatalog,
      endpoint: async () => connection.endpoint,
      enroll: async () => client,
      client: () => client,
    });
    try {
      await manager.add({ url: connection.endpoint.url, code: 'c'.repeat(48), allowHttp: true });
      await manager.command(id, 'physical-one', entity.id, { action: 'set', value: true });
      expect(command).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledTimes(1);
      entity.available = false;
      await manager.refresh(id);
      await expect(
        manager.command(id, 'physical-one', entity.id, { action: 'set', value: true }),
      ).rejects.toThrow('bridge_entity_unavailable');
      expect(command).toHaveBeenCalledTimes(1);
    } finally {
      await owner.close();
    }
  });
  it('revokes an App enrollment with a mismatched identity before storing it', async () => {
    const owner = await openTestCameraCatalog();
    const revoke = vi.fn(async () => ({}));
    const inventory = vi.fn(async () => ({}));
    const manager = new NativeProviders({
      catalog: owner.cameraCatalog,
      endpoint: async () => ({ url: 'http://192.168.1.20:8580' }),
      enroll: async () => ({
        connection: {
          bridgeId: randomUUID(),
          provider: 'tuya',
          endpoint: { url: 'http://192.168.1.20:8580' },
        },
        inventory,
        revoke,
      }),
    });
    try {
      await expect(
        manager.add(
          { url: 'http://192.168.1.20:8580', code: 'a'.repeat(48), allowHttp: true },
          { bridgeId: randomUUID(), provider: 'aqara' },
        ),
      ).rejects.toThrow('app_accessories_identity_mismatch');
      expect(manager.list()).toEqual([]);
      expect(revoke).toHaveBeenCalledOnce();
      expect(inventory).not.toHaveBeenCalled();
    } finally {
      await owner.close();
    }
  });
  it('does not retire MQTT or change recorded camera IDs during enrollment until explicit complete HA handover', async () => {
    const db = new DatabaseSync(':memory:');
    const id = randomUUID();
    const token = 'a'.repeat(64);
    const actions: unknown[][] = [];
    const owner = await openTestCameraCatalog(':memory:');
    const connection: NativeProviderConnection = {
      bridgeId: id,
      provider: 'aqara',
      clientId: randomUUID(),
      token,
      endpoint: {
        url: 'http://192.168.1.20:8580',
        address: '192.168.1.20',
        family: 4,
        allowHttp: true,
      },
    };
    const inventory: NativeProviderInventory = {
      version: 2,
      bridgeId: id,
      provider: 'aqara',
      revision: 'b'.repeat(64),
      cameras: [
        {
          id: 'physical-one',
          name: 'One',
          manufacturer: 'Aqara',
          model: 'G5 Pro',
          available: true,
          identifiers: ['one'],
          stream: { url: 'rtsp://192.168.1.20:8554/one', transport: 'p2p' },
          snapshotPath: '/api/cameras/one/snapshot/last-live',
          entities: [],
        },
      ],
    };
    const client: NativeBridgeClientPort = {
      connection,
      inventory: async () => structuredClone(inventory),
      ready: async (...args) => {
        actions.push(['ready', ...args]);
      },
      revoke: async () => {
        actions.push(['revoke']);
      },
    };
    const manager = new NativeProviders({
      store: { db },
      catalog: owner.cameraCatalog,
      endpoint: async () => connection.endpoint,
      enroll: async () => client,
      client: () => client,
    });
    try {
      db.exec(
        "CREATE TABLE events(id TEXT PRIMARY KEY,camera_id TEXT,digest TEXT);INSERT INTO events VALUES('old-event','camera.outdoor_camera','original-digest')",
      );
      const old = JSON.stringify(db.prepare('SELECT * FROM events').all());
      await manager.add({ url: connection.endpoint.url, allowHttp: true, code: 'c'.repeat(48) });
      expect(actions).toEqual([]);
      expect(JSON.stringify(manager.list()).includes(token)).toBe(false);
      expect(await manager.bind(id, 'physical-one', 'camera.outdoor_camera')).toBe(
        'camera.outdoor_camera',
      );
      expect(JSON.stringify(db.prepare('SELECT * FROM events').all())).toBe(old);
      await manager.confirm(id, inventory.revision, ['camera/physical-one']);
      expect(actions[0]?.[0]).toBe('ready');
      await manager.remove(id);
      expect(manager.list()).toEqual([]);
      expect(await manager.identities.resolve(id, 'physical-one')).toBe('camera.outdoor_camera');
      expect(JSON.stringify(db.prepare('SELECT * FROM events').all())).toBe(old);
    } finally {
      db.close();
      await owner.close();
    }
  });

  it('prevents a delayed native inventory response from resurrecting a removed provider', async () => {
    const db = new DatabaseSync(':memory:');
    const id = randomUUID();
    const owner = await openTestCameraCatalog(':memory:');
    let resolveInventory!: (value: NativeProviderInventory) => void;
    const connection: NativeProviderConnection = {
      bridgeId: id,
      provider: 'tuya',
      clientId: randomUUID(),
      token: 'a'.repeat(64),
      endpoint: {
        url: 'http://192.168.1.20:6766',
        address: '192.168.1.20',
        family: 4,
        allowHttp: true,
      },
    };
    const manager = new NativeProviders({
      store: { db },
      catalog: owner.cameraCatalog,
      client: () => ({
        connection,
        inventory: () =>
          new Promise<NativeProviderInventory>((done) => {
            resolveInventory = done;
          }),
        revoke: async () => {},
      }),
    });
    try {
      await owner.cameraCatalog.native.addProvider({
        id,
        connection: JSON.stringify(connection),
        createdAt: 1,
      });
      const pending = manager.refresh(id);
      await manager.remove(id);
      resolveInventory({
        version: 2,
        bridgeId: id,
        provider: 'tuya',
        cameras: [],
        revision: 'b'.repeat(64),
      });
      await expect(pending).rejects.toThrow(/not_found/);
      expect(manager.list()).toEqual([]);
      expect(manager.live.has(id)).toBe(false);
    } finally {
      db.close();
      await owner.close();
    }
  });
});
