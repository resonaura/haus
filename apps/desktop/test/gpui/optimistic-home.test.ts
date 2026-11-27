/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import type { ClientSessionCredentials } from '@haus/core/auth';
import { homeDashboard } from '../../src/gpui/home/model.js';
import { GpuiHomeRuntime } from '../../src/gpui/home/runtime.js';

interface DeferredCommand {
  readonly url: string;
  readonly body: Record<string, unknown>;
  resolve(): void;
  reject(error: unknown): void;
}

function createMockHubFetch() {
  const endpointStates: Record<string, Record<string, unknown>> = {
    'lamp-a-ep': { state: 'off', brightness: 100 },
    'lamp-b-ep': { state: 'off', brightness: 100 },
  };
  const pendingCommands: DeferredCommand[] = [];

  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (url.endsWith('/api/auth/identity')) {
      return json({
        hub: { hubId: 'hub-1', homeId: 'home-1', name: 'Test Hub', onboarded: true },
      });
    }
    if (url.endsWith('/api/auth/resume') || url.endsWith('/api/auth/session')) {
      return json({
        status: 'active',
        session: {
          sessionId: 'sess-gpui-1',
          hubUrl: 'http://127.0.0.1:18790',
          hubId: 'hub-1',
          homeId: 'home-1',
          clientId: 'gpui-test',
          clientName: 'Haus Desktop',
          clientRole: 'admin',
          issuedAt: 1_000,
          expiresAt: Date.now() + 3_600_000,
          state: 'active',
        },
      });
    }
    if (url.endsWith('/api/preferences')) {
      return json({ revision: 'rev-1', value: {}, updatedAt: 1_000 });
    }
    if (url.endsWith('/api/rooms')) {
      return json({ rooms: [{ id: 'studio', name: 'Studio' }] });
    }
    if (url.endsWith('/api/commissioning/integrations')) {
      return json({ entries: [] });
    }
    if (url.endsWith('/api/scenes') || url.endsWith('/api/automations')) {
      return json({ scenes: [], automations: [] });
    }
    if (url.endsWith('/api/devices')) {
      return json({
        devices: [
          {
            id: 'lamp-a',
            name: 'Desk Lamp 1',
            category: 'lighting',
            roomId: 'studio',
            availability: 'online',
            endpoints: [
              {
                id: 'lamp-a-ep',
                name: 'Desk Lamp 1',
                capabilities: [
                  {
                    id: 'on_off',
                    kind: 'binary',
                    readable: true,
                    operations: ['turn_on', 'turn_off'],
                  },
                  {
                    id: 'brightness',
                    kind: 'numeric',
                    readable: true,
                    operations: ['set_brightness'],
                  },
                ],
              },
            ],
          },
          {
            id: 'lamp-b',
            name: 'Desk Lamp 2',
            category: 'lighting',
            roomId: 'studio',
            availability: 'online',
            endpoints: [
              {
                id: 'lamp-b-ep',
                name: 'Desk Lamp 2',
                capabilities: [
                  {
                    id: 'on_off',
                    kind: 'binary',
                    readable: true,
                    operations: ['turn_on', 'turn_off'],
                  },
                ],
              },
            ],
          },
        ],
      });
    }
    if (url.endsWith('/api/states')) {
      return json({ states: structuredClone(endpointStates) });
    }
    if (url.includes('/api/devices/') && url.endsWith('/command') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Promise<Response>((resolve, reject) => {
        pendingCommands.push({
          url,
          body,
          resolve: () => {
            const ep = String(body.endpointId ?? '');
            const next: Record<string, unknown> = { ...endpointStates[ep] };
            if (body.command === 'turn_on') next.state = 'on';
            if (body.command === 'turn_off') next.state = 'off';
            const params = body.parameters as Record<string, unknown> | undefined;
            if (typeof params?.brightness === 'number') {
              next.state = params.brightness > 0 ? 'on' : 'off';
              next.brightness = params.brightness;
            }
            endpointStates[ep] = next;
            resolve(json({ ok: true, endpointId: ep, state: next }));
          },
          reject,
        });
      });
    }
    return json({}, 404);
  };

  return { fetchFn, endpointStates, pendingCommands };
}

function createSavedHubStore(): {
  assertAvailable(): void;
  loadHubSession(): Promise<ClientSessionCredentials | null>;
  saveHubSession(value: ClientSessionCredentials): Promise<void>;
  clearHubSession(): Promise<void>;
} {
  let session: ClientSessionCredentials | null = {
    sessionId: 'sess-gpui-1',
    hubUrl: 'http://127.0.0.1:18790',
    hubId: 'hub-1',
    homeId: 'home-1',
    clientId: 'gpui-test',
    clientName: 'Haus Desktop',
    clientRole: 'admin',
    sessionToken: 'tok-gpui-session-0123456789abcdef',
    refreshToken: 'ref-gpui-session-0123456789abcdef',
    expiresAt: Date.now() + 3_600_000,
  };
  return {
    assertAvailable() {},
    async loadHubSession() {
      return session;
    },
    async saveHubSession(value) {
      session = value;
    },
    async clearHubSession() {
      session = null;
    },
  };
}

describe('GPUIX native desktop optimistic device state', () => {
  it('projects toggles and rapid double-toggles at 0ms without setting global busy, then reconciles', async () => {
    const { fetchFn, pendingCommands } = createMockHubFetch();
    const runtime = new GpuiHomeRuntime(createSavedHubStore(), fetchFn);
    try {
      await runtime.start();
      const initialSnap = runtime.getSnapshot().snapshot!;
      const lampEntityId = initialSnap.states.find((s) =>
        String(s.attributes.friendly_name).includes('Desk Lamp 1'),
      )!.entity_id;
      expect(initialSnap.states.find((s) => s.entity_id === lampEntityId)?.state).toBe('off');

      // 1st click: turn ON — must project in 0ms synchronously before HTTP command finishes
      const firstToggle = runtime.controlDevice(lampEntityId, 'toggle');
      const afterFirst = runtime.getSnapshot();
      expect(afterFirst.busy).toBe(false);
      expect(afterFirst.snapshot?.states.find((s) => s.entity_id === lampEntityId)?.state).toBe(
        'on',
      );
      expect(afterFirst.snapshot?.pendingEntityIds).toContain(lampEntityId);
      expect(
        runtime.getConfirmedSnapshot()?.states.find((s) => s.entity_id === lampEntityId)?.state,
      ).toBe('off');

      // Dashboard model reflects active + pending immediately for GPUIX tiles
      const tile = homeDashboard(afterFirst.snapshot!, {
        ...afterFirst.preferences,
        autoGroupLights: false,
      })
        .rooms.flatMap((r) => r.devices)
        .find((d) => d.id === lampEntityId);
      expect(tile?.active).toBe(true);
      expect(tile?.pending).toBe(true);

      // 2nd rapid click BEFORE 1st HTTP request resolves: reads optimistic 'on' -> queues 'turn_off'!
      const secondToggle = runtime.controlDevice(lampEntityId, 'toggle');
      expect(
        runtime.getSnapshot().snapshot?.states.find((s) => s.entity_id === lampEntityId)?.state,
      ).toBe('off');
      await vi.waitFor(() => expect(pendingCommands).toHaveLength(1));
      expect(pendingCommands[0]!.body.command).toBe('turn_on');

      // Resolve 1st HTTP request -> 2nd queued 'turn_off' dispatches automatically in FIFO order
      pendingCommands[0]!.resolve();
      await vi.waitFor(() => expect(pendingCommands).toHaveLength(2));
      expect(pendingCommands[1]!.body.command).toBe('turn_off');

      pendingCommands[1]!.resolve();
      await Promise.all([firstToggle, secondToggle]);

      const settled = runtime.getSnapshot().snapshot!;
      expect(settled.states.find((s) => s.entity_id === lampEntityId)?.state).toBe('off');
      expect(settled.pendingEntityIds).toBeUndefined();
    } finally {
      runtime.dispose();
    }
  });

  it('rolls back single-device HTTP rejection without marking a healthy Hub session offline', async () => {
    const { fetchFn, pendingCommands } = createMockHubFetch();
    const runtime = new GpuiHomeRuntime(createSavedHubStore(), fetchFn);
    try {
      await runtime.start();
      const lampId = runtime.getSnapshot().snapshot!.states[0]!.entity_id;

      const failedCmd = runtime.controlDevice(lampId, 'toggle');
      expect(
        runtime.getSnapshot().snapshot?.states.find((s) => s.entity_id === lampId)?.state,
      ).toBe('on');

      // Reject with HTTP 422 response (not socket TypeError) -> rolls back state, stays online!
      await vi.waitFor(() => expect(pendingCommands).toHaveLength(1));
      pendingCommands[0]!.reject(new Error('The Hub request failed (422).'));
      await failedCmd;

      expect(
        runtime.getSnapshot().snapshot?.states.find((s) => s.entity_id === lampId)?.state,
      ).toBe('off');
      expect(runtime.getSnapshot().offline).toBe(false);
      expect(runtime.getSnapshot().error).toMatch(/could not be confirmed/);
    } finally {
      runtime.dispose();
    }
  });
});
