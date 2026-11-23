/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DemoHomeTransport,
  HttpHubTransport,
  IpcBridgeTransport,
  MemoryDemoModeStore,
  StreamingSocketTransport,
  SwitchableHomeTransport,
  type HomeTransportEvent,
  type TransportAction,
  type TransportEntityState,
  type TransportSnapshot,
} from '../../src/transport/index.js';

function makeFixtureSnapshot(): TransportSnapshot {
  return {
    states: [
      {
        entity_id: 'light.study_lamp',
        state: 'off',
        attributes: { friendly_name: 'Study Lamp' },
      },
      {
        entity_id: 'image.mesh_qr',
        state: '2026-11-23T00:00:00Z',
        attributes: {
          friendly_name: 'Mesh QR Code',
          content_type: 'image/svg+xml',
          entity_picture: 'data:image/svg+xml;utf8,<svg/>',
        },
      },
      {
        entity_id: 'update.mesh_fw',
        state: 'on',
        attributes: {
          installed_version: 'v7.17.4',
          latest_version: 'v7.18.0',
          release_summary: 'Stability improvements.',
        },
      },
    ],
    areas: [{ area_id: 'study', name: 'Study' }],
    devices: [{ id: 'dev_mesh', name: 'Mesh Router', area_id: 'study' }],
    entities: [{ entity_id: 'light.study_lamp', area_id: 'study', name: null }],
    services: { light: { turn_on: {}, turn_off: {} } },
    config: { location_name: 'Sample Home', version: 'demo' },
    user: { id: 'demo_user', name: 'Demo', is_admin: true },
    sceneConfigs: { 'scene.evening': { id: 'evening', name: 'Evening' } },
  };
}

function applyFixtureAction(
  snapshot: TransportSnapshot,
  action: TransportAction,
): TransportSnapshot {
  if (action.domain === 'light') {
    const nextState = action.service === 'turn_on' ? 'on' : 'off';
    return {
      ...snapshot,
      states: snapshot.states.map((entity) =>
        entity.entity_id === action.target.entity_id ? { ...entity, state: nextState } : entity,
      ),
    };
  }
  return snapshot;
}

describe('@haus/core/transport', () => {
  it('DemoHomeTransport serves RPCs locally and emits state_changed & registry_updated events', async () => {
    const demo = new DemoHomeTransport({
      createSnapshot: makeFixtureSnapshot,
      applyAction: applyFixtureAction,
    });
    const events: HomeTransportEvent[] = [];
    demo.onEvent((event) => events.push(event));

    const states = await demo.request<TransportEntityState[]>({ type: 'get_states' });
    expect(states).toHaveLength(3);

    const qr = await demo.request<{ dataUrl: string | null; content_type: string }>({
      type: 'haus/entity_image',
      entity_id: 'image.mesh_qr',
    });
    expect(qr.dataUrl).toBe('data:image/svg+xml;utf8,<svg/>');
    expect(qr.content_type).toBe('image/svg+xml');

    const notes = await demo.request<string | null>({
      type: 'update/release_notes',
      entity_id: 'update.mesh_fw',
    });
    expect(notes).toBe('Stability improvements.');

    await demo.request({
      type: 'call_service',
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: 'light.study_lamp' },
    });
    expect(demo.getSnapshot().states[0]?.state).toBe('on');
    expect(
      events.some((e) => e.type === 'state_changed' && e.entityId === 'light.study_lamp'),
    ).toBe(true);

    const createdArea = await demo.request<{ area_id: string; name: string }>({
      type: 'config/area_registry/create',
      name: 'Studio',
    });
    expect(createdArea.name).toBe('Studio');
    expect(
      events.some((e) => e.type === 'registry_updated' && e.eventType === 'area_registry_updated'),
    ).toBe(true);

    expect(await demo.getSceneConfig('scene.evening', 'evening')).toEqual({
      id: 'evening',
      name: 'Evening',
    });
  });

  it('SwitchableHomeTransport routes between live IPC and demo without discarding live transport', async () => {
    let bridgeListener: ((event: unknown) => void) | undefined;
    const liveRequests: Record<string, unknown>[] = [];
    const live = new IpcBridgeTransport({
      request: async <T>(msg: Record<string, unknown>) => {
        liveRequests.push(msg);
        return [{ entity_id: 'light.real_home', state: 'on', attributes: {} }] as T;
      },
      onEvent: (cb) => {
        bridgeListener = cb;
        return () => {
          bridgeListener = undefined;
        };
      },
    });
    const demo = new DemoHomeTransport({
      createSnapshot: makeFixtureSnapshot,
      applyAction: applyFixtureAction,
    });
    const storage = new MemoryDemoModeStore(false);
    const transport = new SwitchableHomeTransport({ live, demo, storage });
    const received: HomeTransportEvent[] = [];
    transport.onEvent((event) => received.push(event));

    expect(transport.mode).toBe('live');
    const liveStates = await transport.request<TransportEntityState[]>({ type: 'get_states' });
    expect(liveStates[0]?.entity_id).toBe('light.real_home');
    expect(liveRequests).toHaveLength(1);

    // Switch to Demo Mode: live requests stop and live background connection failures are suppressed.
    transport.setMode('demo');
    expect(transport.mode).toBe('demo');
    expect(storage.read()).toBe(true);

    bridgeListener?.({ type: 'connection', status: 'disconnected', error: 'Offline' });
    expect(received.some((e) => e.type === 'connection' && e.status === 'disconnected')).toBe(
      false,
    );

    const demoStates = await transport.request<TransportEntityState[]>({ type: 'get_states' });
    expect(demoStates[0]?.entity_id).toBe('light.study_lamp');
    expect(liveRequests).toHaveLength(1);

    // Non-persistent fallback demo does not overwrite storage when explicitly requested.
    transport.setMode('live');
    expect(storage.read()).toBe(false);
    transport.setMode('demo', { persist: false });
    expect(transport.mode).toBe('demo');
    expect(storage.read()).toBe(false);

    // Returning to live restores live transport events and RPC routing without re-creating it.
    transport.setMode('live');
    bridgeListener?.({ type: 'connection', status: 'connected' });
    expect(received.some((e) => e.type === 'connection' && e.status === 'connected')).toBe(true);
    const liveAgain = await transport.request<TransportEntityState[]>({ type: 'get_states' });
    expect(liveAgain[0]?.entity_id).toBe('light.real_home');
    expect(liveRequests).toHaveLength(2);
  });

  it('SwitchableHomeTransport exposes a Core RuntimeTransport adapter for mobile/store runtimes', async () => {
    const demo = new DemoHomeTransport({
      createSnapshot: makeFixtureSnapshot,
      applyAction: applyFixtureAction,
    });
    const transport = new SwitchableHomeTransport({ live: null, demo });
    const runtimeTransport = transport.asRuntimeTransport();

    const valueSnapshots: Array<readonly TransportEntityState[]> = [];
    runtimeTransport.watchValues((values) => valueSnapshots.push(values));

    const receipt = await runtimeTransport.execute({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: 'light.study_lamp' },
    });
    expect(receipt.status).toBe('accepted');
    expect(receipt.correlationId).toMatch(/^demo-/);
    expect(valueSnapshots.at(-1)?.[0]?.state).toBe('on');
  });

  it('StreamingSocketTransport and HttpHubTransport adapt mobile/web protocols cleanly', async () => {
    let emitState: ((state: 'connected' | 'reconnecting') => void) | undefined;
    let emitEntities: ((entities: readonly TransportEntityState[]) => void) | undefined;
    const socketTransport = new StreamingSocketTransport({
      connected: true,
      close: vi.fn(),
      request: async <T>(msg: { type: string }) => ({ ok: msg.type }) as T,
      watchState: (cb) => {
        emitState = cb as (state: 'connected' | 'reconnecting') => void;
        return () => undefined;
      },
      watchEntities: (cb) => {
        emitEntities = cb;
        return () => undefined;
      },
    });
    const socketEvents: HomeTransportEvent[] = [];
    socketTransport.onEvent((event) => socketEvents.push(event));
    emitState?.('connected');
    emitEntities?.([{ entity_id: 'light.hall', state: 'on', attributes: {} }]);
    expect(socketEvents[0]).toEqual({ type: 'connection', status: 'connected' });
    expect(socketEvents[1]).toMatchObject({ type: 'state_changed', entityId: 'light.hall' });

    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ pong: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const http = new HttpHubTransport({
      baseUrl: 'https://hub.local/',
      getAuthHeader: () => 'Bearer test-token',
      fetchImpl: fetchMock,
    });
    const res = await http.request<{ pong: boolean }>({ type: 'ping' });
    expect(res.pong).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub.local/api/rpc',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer test-token' }),
      }),
    );
  });
});
