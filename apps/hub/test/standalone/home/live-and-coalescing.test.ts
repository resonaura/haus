/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import type { HausDevice } from '@haus/core';
import { WebSocket } from 'ws';
import { HubLiveService } from '../../../src/live/live.service.js';
import type { LivePublishOptions, LiveService, LiveState } from '../../../src/live/types.js';
import { StandaloneHomeService } from '../../../src/home/home.service.js';

function makeLightDevice(id = 'dev_lamp_1', epId = 'ep_lamp_1'): HausDevice {
  return {
    id,
    name: 'Desk Lamp',
    category: 'lighting',
    availability: 'online',
    connectivity: { protocol: 'virtual' },
    roomId: 'office',
    source: { instanceId: 'entry-1', externalId: id },
    endpoints: [
      {
        id: epId,
        name: 'Desk Lamp',
        sourceOwner: { protocol: 'vendor', externalId: 'entry-1', domain: 'hue' },
        readings: {},
        capabilities: [
          {
            id: 'on_off',
            kind: 'binary',
            readable: true,
            operations: ['turn_on', 'turn_off', 'toggle'],
          },
          { id: 'brightness', kind: 'percentage', readable: true, operations: ['set'] },
          { id: 'color_temp_kelvin', kind: 'numeric', readable: true, operations: ['set'] },
        ],
      },
    ],
  };
}

describe('Instant Live delta pushes, separate stateQueue, and rapid light coalescing', () => {
  it('flushes live stateChanges via microtask without timer delay and redacts nested secrets', async () => {
    const published: Array<{ topic: string; options?: LivePublishOptions }> = [];
    const liveMock: LiveService = {
      publish: vi.fn((topic: string, options?: LivePublishOptions) => {
        published.push({ topic, options });
      }),
      getState: vi.fn((topic = 'home') => ({
        protocol: 1,
        instance: '11111111-1111-4111-8111-111111111111',
        sequence: 1,
        topic,
        revision: '0',
        connected: true,
      })) as unknown as LiveService['getState'],
      setConnected: vi.fn(),
      setRevision: vi.fn(),
      setSourcesProvider: vi.fn(),
      authorize: vi.fn(() => true),
      addClient: vi.fn(),
      removeClient: vi.fn(),
      getClientCount: vi.fn(() => 1),
    };

    const home = new StandaloneHomeService(liveMock);
    try {
      home.registerDevice(makeLightDevice());
      await home.updateEndpointState('ep_lamp_1', {
        state: 'on',
        brightness: 210,
        access_token: 'top-secret',
        attributes: { color_mode: 'brightness', rtsp_url: 'rtsp://user:pass@cam' },
      });

      // Microtask flush happens immediately without waiting for a 10ms+ timer.
      await Promise.resolve();
      const deltaEvent = published.find((p) => p.topic === 'devices' && p.options?.stateChanges);
      expect(deltaEvent).toBeDefined();
      expect(deltaEvent?.options?.stateChanges?.ep_lamp_1?.brightness).toBe(210);

      // Verify HubLiveService strips top-level + nested secrets and caps oversized frames.
      const realLive = new HubLiveService();
      const sentPayloads: string[] = [];
      const fakeSocket = {
        readyState: WebSocket.OPEN,
        bufferedAmount: 0,
        on: vi.fn(),
        send: vi.fn((data: string) => sentPayloads.push(data)),
        terminate: vi.fn(),
        ping: vi.fn(),
      } as unknown as WebSocket;
      realLive.addClient(fakeSocket);
      try {
        realLive.publish('devices', {
          stateChanges: {
            ep_lamp_1: {
              state: 'on',
              brightness: 210,
              access_token: 'secret-token',
              attributes: { color_mode: 'brightness', bindkey: 'deadbeef' },
            },
          },
          registryChanged: false,
        });
        expect(sentPayloads).toHaveLength(1);
        const frame = JSON.parse(sentPayloads[0]!) as LiveState;
        expect(frame.stateChanges?.ep_lamp_1?.brightness).toBe(210);
        expect(frame.stateChanges?.ep_lamp_1?.access_token).toBeUndefined();
        expect(
          (frame.stateChanges?.ep_lamp_1?.attributes as Record<string, unknown>)?.bindkey,
        ).toBeUndefined();

        // Oversized >48 KiB stateChanges falls back cleanly to compact invalidation frame.
        realLive.publish('devices', {
          stateChanges: { ep_lamp_1: { blob: 'x'.repeat(60_000) } },
          registryChanged: false,
        });
        const compact = JSON.parse(sentPayloads[1]!) as LiveState;
        expect(compact.topic).toBe('devices');
        expect(compact.stateChanges).toBeUndefined();
      } finally {
        realLive.onModuleDestroy();
      }
    } finally {
      home.onModuleDestroy();
    }
  });

  it('coalesces rapid waiting light commands while preserving FIFO barriers for toggle and relative steps', async () => {
    const home = new StandaloneHomeService();
    try {
      home.registerDevice(makeLightDevice());
      const executed: Array<{ command: string; params?: Record<string, unknown> }> = [];
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstCall = true;

      home.registerCommandHandler(
        { protocol: 'vendor', externalId: 'entry-1', domain: 'hue' },
        async (_ep, _cap, cmd, params) => {
          if (firstCall) {
            firstCall = false;
            await firstGate;
          }
          executed.push({ command: cmd, params: params ? { ...params } : undefined });
        },
        { optimistic: false },
      );

      // Start an in-flight command, then burst 5 absolute slider updates + 1 toggle barrier + 1 step.
      const p0 = home.executeDeviceCommand('ep_lamp_1', 'on_off', 'turn_on', { brightness: 10 });
      const p1 = home.executeDeviceCommand('ep_lamp_1', 'on_off', 'turn_on', { brightness: 60 });
      const p2 = home.executeDeviceCommand('ep_lamp_1', 'on_off', 'turn_on', {
        color_temp_kelvin: 4100,
      });
      const p3 = home.executeDeviceCommand('ep_lamp_1', 'on_off', 'turn_on', { brightness: 200 });
      const pToggle = home.executeDeviceCommand('ep_lamp_1', 'on_off', 'toggle');
      const pStep = home.executeDeviceCommand('ep_lamp_1', 'on_off', 'turn_on', {
        brightness_step_pct: 10,
      });

      // Inbound state update on the SAME endpoint must NOT block behind the slow outbound command!
      const stateUpdated = vi.fn();
      const statePromise = home
        .updateEndpointState('ep_lamp_1', { state: 'on', brightness: 15 })
        .then(stateUpdated);
      await statePromise;
      expect(stateUpdated).toHaveBeenCalledTimes(1);
      expect(home.getEndpointState('ep_lamp_1')?.brightness).toBe(15);

      releaseFirst();
      await Promise.all([p0, p1, p2, p3, pToggle, pStep]);

      // 1 in-flight + 1 coalesced (merging brightness=200 + color_temp_kelvin=4100) + toggle + step = 4.
      expect(executed).toHaveLength(4);
      expect(executed[0]).toEqual({ command: 'turn_on', params: { brightness: 10 } });
      expect(executed[1]).toEqual({
        command: 'turn_on',
        params: { brightness: 200, color_temp_kelvin: 4100 },
      });
      expect(executed[2]).toEqual({ command: 'toggle', params: undefined });
      expect(executed[3]).toEqual({ command: 'turn_on', params: { brightness_step_pct: 10 } });
    } finally {
      home.onModuleDestroy();
    }
  });
});
