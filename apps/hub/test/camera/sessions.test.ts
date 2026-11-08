/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import { nvrCameraSource } from '../../src/camera/index.js';
import {
  camera,
  createSessionsFixture,
  deferred,
  owner,
  session,
  state,
  type SessionTestCall,
} from './sessions-fixture.js';

describe('NvrCameraSessions — routing, continuity and source selection', () => {
  it('durable prebuffer follows its actual assigned node, retains outage context and revokes explicit Off without assigning standbys', async () => {
    const f = await createSessionsFixture();
    try {
      for (const node of f.nodes) {
        const health = f.cluster.health.get(node.id);
        if (health?.remote) health.remote.features = { cameraContinuity: 1 };
      }
      await f.sessions.ensure(f.registry.cameras[0], f.sessions.recordingOwner);
      f.registry.states.push({ entity_id: camera.id, state: 'idle' });
      await f.sessions.syncContinuity(true);
      const policies = f.calls.filter((call) => call.path === '/v1/camera-continuity');
      assert.equal(policies.length, 2);
      const assigned = policies.find(
        (call) => ((call.data?.cameras as unknown[] | undefined) ?? []).length > 0,
      );
      assert.ok(assigned);
      assert.equal(
        policies.filter((call) => ((call.data?.cameras as unknown[] | undefined) ?? []).length > 0)
          .length,
        1,
      );
      const cameras = assigned.data?.cameras as { source: { kind: string } }[];
      assert.equal(cameras[0].source.kind, 'p2p-restream');
      const assignedNode = f.nodes.find((node) => node.id === assigned.node)!;
      assignedNode.enabled = false;
      await f.sessions.syncContinuity(true);
      assert.equal(
        (
          f.calls
            .filter((call) => call.path === '/v1/camera-continuity' && call.node === assigned.node)
            .at(-1)?.data?.cameras as unknown[] | undefined
        )?.length,
        0,
      );
      assignedNode.enabled = true;
      f.registry.cameras[0].available = false;
      await f.sessions.syncContinuity(true);
      assert.equal(
        (
          f.calls
            .filter((call) => call.path === '/v1/camera-continuity' && call.node === assigned.node)
            .at(-1)?.data?.cameras as unknown[] | undefined
        )?.length,
        1,
      );
      f.registry.states.find((item) => item.entity_id === camera.id)!.state = 'off';
      await f.sessions.syncContinuity(true);
      assert.ok(
        f.calls
          .filter((call) => call.path === '/v1/camera-continuity')
          .slice(-2)
          .every((call) => (call.data?.cameras as unknown[] | undefined)?.length === 0),
      );
    } finally {
      await f.cleanup();
    }
  });

  it('recording reuses the authorized activity producer even when its node has no spare source slot', async () => {
    const f = await createSessionsFixture();
    try {
      const healthA = f.cluster.health.get('a');
      if (healthA?.remote?.rtspSessions) {
        healthA.remote.rtspSessions.active = 1;
        healthA.remote.rtspSessions.max = 1;
      }
      f.sessions.activityAssignedNode = () => f.nodes[0];
      await f.sessions.ensure(f.registry.cameras[0], f.sessions.recordingOwner);
      assert.equal(f.calls.find((call) => call.path === '/v1/cameras/sessions')?.node, 'a');
    } finally {
      await f.cleanup();
    }
  });

  it('failed preferred Live startup releases its temporary source owner without releasing the recording', async () => {
    const f = await createSessionsFixture();
    try {
      await f.sessions.ensure(camera, f.sessions.recordingOwner, false, f.nodes[0]);
      f.nodes[1].livePriority = 100;
      for (const health of f.cluster.health.values()) {
        if (health.remote) health.remote.features = { rtspPeer: true };
      }
      const ensure = f.sessions.ensure.bind(f.sessions);
      const json = f.sessions.json;
      f.sessions.json = async (node, path, options) => {
        const data = options?.data as { peer?: unknown } | undefined;
        if (data?.peer) throw Error('camera_session_busy');
        return json(node, path, options);
      };
      f.sessions.ensure = async (...args) => {
        if (args[1] === owner) throw Error('camera_session_unavailable');
        return ensure(...args);
      };
      await assert.rejects(f.sessions.ensureLive(camera, owner), /camera_session_unavailable/);
      assert.ok(f.sessions.entries.has(`${camera.id}:${f.sessions.recordingOwner}`));
      assert.equal(
        [...f.sessions.entries.values()].filter((entry) => entry.owner.startsWith('peer-source-'))
          .length,
        0,
      );
      f.sessions.ensure = ensure;
      const recovered = await f.sessions.ensureLive(camera, owner);
      assert.equal(recovered.owner, owner);
      assert.equal(
        [...f.sessions.entries.values()].filter((entry) => entry.owner.startsWith('peer-source-'))
          .length,
        0,
      );
      await f.sessions.release(camera.id, owner);
      assert.ok(f.sessions.entries.has(`${camera.id}:${f.sessions.recordingOwner}`));
    } finally {
      await f.cleanup();
    }
  });

  it('simultaneous owners open one shared producer without racing onto separate nodes', async () => {
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const calls: string[] = [];
    const f = await createSessionsFixture({
      json: async (node) => {
        calls.push(node.id);
        if (calls.length === 1) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        return session;
      },
    });
    try {
      for (const health of f.cluster.health.values()) {
        if (health.remote?.rtspSessions) {
          health.remote.rtspSessions.active = 0;
          health.remote.rtspSessions.max = 1;
        }
      }
      const first = f.sessions.touch(camera, owner, true);
      await firstStarted.promise;
      const second = f.sessions.touch(camera, owner + '-viewer', true);
      await new Promise((resolve) => setImmediate(resolve));
      releaseFirst.resolve();
      assert.deepEqual(
        (await Promise.all([first, second])).map((r) => r.warm),
        [true, true],
      );
      assert.deepEqual(
        calls,
        ['a', 'a'],
        'join the first producer, including when that node has no spare source slots',
      );
    } finally {
      await f.cleanup();
    }
  });

  it('new owners reuse the warm camera producer even when another node is less loaded', async () => {
    const f = await createSessionsFixture();
    try {
      assert.equal((await f.sessions.touch(camera, owner, true)).warm, true);
      assert.equal(f.calls.at(-1)?.node, 'b');
      const healthA = f.cluster.health.get('a');
      const healthB = f.cluster.health.get('b');
      if (healthA?.remote?.rtspSessions) healthA.remote.rtspSessions.active = 0;
      if (healthB?.remote?.rtspSessions) healthB.remote.rtspSessions.active = 1;
      assert.equal((await f.sessions.touch(camera, owner + '-viewer', true)).warm, true);
      assert.equal(
        f.calls.at(-1)?.node,
        'b',
        'attach the owner to the existing producer rather than open a duplicate on the freer node',
      );
      if (healthB) healthB.online = false;
      assert.equal((await f.sessions.touch(camera, owner + '-replacement', true)).warm, true);
      assert.equal(
        f.calls.at(-1)?.node,
        'a',
        'an offline producer still fails over to a healthy node',
      );
    } finally {
      await f.cleanup();
    }
  });

  it('a viewer revalidates a recent warm lease and recreates a producer after node restart', async () => {
    const ids = [randomUUID(), randomUUID()];
    let generation = 0;
    const calls: SessionTestCall[] = [];
    const f = await createSessionsFixture({
      json: async (node, path, options) => {
        const nodeWithId = node as { id?: string };
        calls.push({ node: nodeWithId.id, path, method: options?.method });
        if (path === '/v1/cameras/sessions') return { ...session, id: ids[generation] };
        if (path.endsWith('/lease')) {
          if (!path.includes(ids[generation])) throw Error('camera_session_not_found');
          return { ...session, id: ids[generation] };
        }
        if (path.endsWith('/webrtc')) {
          if (!path.includes(ids[generation])) throw Error('camera_session_not_found');
          return {
            viewerId: randomUUID(),
            answer: { type: 'answer', sdp: 'v=0\r\n' },
          };
        }
        throw Error('unexpected_node_operation');
      },
    });
    try {
      await f.sessions.touch(camera, owner, true);
      generation = 1; // The node restarted immediately after the successful preheat.
      const viewer = await f.sessions.viewer(camera, owner, randomUUID(), 'v=0\r\n');
      assert.equal(viewer.answer.type, 'answer');
      assert.ok(
        calls.some((call) => call.path.endsWith('/lease')),
        'camera opening must not trust a cached session UUID after a restart',
      );
      assert.equal(f.sessions.entries.get(`${camera.id}:${owner}`)?.id, ids[1]);
    } finally {
      await f.cleanup();
    }
  });

  it('only explicit protected P2P telemetry selects Aqara, never native RTSP, unrelated URLs, or HA HLS', () => {
    assert.deepEqual(
      nvrCameraSource(camera, {
        states: [state('rtsp://192.168.4.44:8556')],
        entities: [],
      }),
      { kind: 'p2p-restream', url: 'rtsp://192.168.4.44:8556' },
    );
    assert.throws(
      () =>
        nvrCameraSource(camera, {
          states: [
            {
              entity_id: 'sensor.garden_rtsp_stream',
              state: 'rtsp://192.168.4.44/native',
            },
          ],
          entities: [],
        }),
      /protected_p2p/,
    );
    assert.throws(
      () =>
        nvrCameraSource(camera, {
          states: [
            state('unavailable'),
            {
              entity_id: 'sensor.garden_rtsp_stream',
              state: 'rtsp://192.168.4.44/native',
            },
          ],
          entities: [],
        }),
      /source_unavailable/,
    );
    assert.throws(
      () =>
        nvrCameraSource(camera, {
          states: [state('rtsp://localhost/live')],
          entities: [],
        }),
      /not_reachable/,
    );
    assert.throws(
      () =>
        nvrCameraSource(camera, {
          states: [state('https://ha.local/api/hls/live')],
          entities: [],
        }),
      /source_unavailable/,
    );
  });

  it('Eufy keeps its explicitly configured RTSP route and never bypasses a registered P2P route', () => {
    const eufy = {
      ...camera,
      aliases: ['camera.garden_internal'],
      deviceIds: ['eufy-camera'],
      playbackSource: {
        platform: 'eufy_security',
        manufacturer: 'Eufy Security',
        model: 'T8410C',
      },
    };
    const native = {
      entity_id: 'sensor.garden_rtsp_stream_url',
      state: 'rtsp://user:private@192.168.4.22/live',
    };
    const entry = { entity_id: native.entity_id, device_id: 'eufy-camera' };
    const provider = {
      entity_id: 'sensor.garden_stream_provider',
      state: 'RTSP',
    };
    assert.deepEqual(nvrCameraSource(eufy, { states: [native, provider], entities: [entry] }), {
      kind: 'rtsp',
      url: native.state,
    });
    assert.deepEqual(
      nvrCameraSource(eufy, {
        states: [native, { ...provider, state: 'P2P' }, state('rtsp://192.168.4.44/p2p')],
        entities: [entry],
      }),
      { kind: 'p2p-restream', url: 'rtsp://192.168.4.44/p2p' },
    );
    for (const registry of [
      { states: [native, provider, state('unavailable')], entities: [entry] },
      {
        states: [native, provider],
        entities: [entry, { entity_id: state('').entity_id, disabled_by: 'user' }],
      },
      {
        states: [native, provider],
        entities: [{ ...entry, disabled_by: 'user' }],
      },
      {
        states: [{ ...native, entity_id: 'sensor.neighbor_rtsp_stream_url' }, provider],
        entities: [],
      },
      {
        states: [{ ...native, state: 'rtsp://8.8.8.8/live' }, provider],
        entities: [entry],
      },
    ])
      assert.throws(() => nvrCameraSource(eufy, registry), /source_unavailable/);
    assert.throws(
      () =>
        nvrCameraSource(eufy, {
          states: [{ ...native, state: 'rtsp://127.0.0.1/live' }, provider],
          entities: [entry],
        }),
      /not_reachable/,
    );
    for (const providers of [
      [],
      [{ ...provider, state: 'P2P' }],
      [{ ...provider, state: 'unavailable' }],
      [{ ...provider, entity_id: 'sensor.neighbor_stream_provider' }],
    ])
      assert.throws(
        () =>
          nvrCameraSource(eufy, {
            states: [native, ...providers],
            entities: [entry],
          }),
        /protected_p2p/,
      );
    assert.throws(
      () =>
        nvrCameraSource(eufy, {
          states: [native, provider],
          entities: [entry, { entity_id: provider.entity_id, disabled_by: 'user' }],
        }),
      /protected_p2p/,
    );
  });

  it('Eufy configured RTSP reaches an NVR without changing camera transport or exposing its source', async () => {
    const f = await createSessionsFixture();
    try {
      f.registry.cameras[0].playbackSource = {
        platform: 'eufy_security',
        manufacturer: 'Eufy Security',
        model: 'T8410C',
      };
      f.registry.cameras[0].aliases = ['camera.garden_internal'];
      f.registry.states = [
        {
          entity_id: 'sensor.garden_rtsp_stream_url',
          state: 'rtsp://user:private@192.168.4.22/live',
        },
        { entity_id: 'sensor.garden_stream_provider', state: 'RTSP' },
      ];
      const result = await f.sessions.touch(f.registry.cameras[0], owner, true);
      assert.equal(result.warm, true);
      assert.equal(result.transport, 'nvr-webrtc');
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].path, '/v1/cameras/sessions');
      assert.deepEqual(f.calls[0].data?.source, {
        kind: 'rtsp',
        url: f.registry.states[0].state,
      });
      assert.equal(f.calls[0].data?.requireAudio, true);
      assert.ok(!JSON.stringify(result).includes('rtsp:'));
      assert.ok(!JSON.stringify(result).includes('private'));
    } finally {
      await f.cleanup();
    }
  });

  it('least-loaded capable node receives exact source privately and warm response never includes credentials', async () => {
    const f = await createSessionsFixture();
    try {
      const result = await f.sessions.touch(camera, owner, true, true);
      assert.equal(result.transport, 'nvr-webrtc');
      assert.equal(result.sessionId, session.id);
      assert.equal(f.calls[0].node, 'b');
      const sourceData = f.calls[0].data?.source as { kind: string; url: string };
      assert.equal(sourceData.kind, 'p2p-restream');
      assert.equal(sourceData.url, 'rtsp://user:private@192.168.4.44:8556/live');
      assert.equal(f.calls[0].data?.advertiseHost, '192.168.5.115');
      assert.equal(f.calls[0].data?.preRollSeconds, 8);
      assert.equal(f.calls[0].data?.recordAudio, true);
      assert.ok(!JSON.stringify(result).includes('private'));
      assert.ok(!JSON.stringify(result).includes('rtsp:'));
    } finally {
      await f.cleanup();
    }
  });

  it('prewarm allocation accounts for sessions opened since the last node-health poll', async () => {
    const requests: SessionTestCall[] = [];
    const f = await createSessionsFixture({
      json: async (node, path, options) => {
        const nodeWithId = node as { id?: string };
        requests.push({ node: nodeWithId.id, path, method: options?.method });
        return { ...session, id: randomUUID() };
      },
    });
    try {
      for (const health of f.cluster.health.values()) {
        if (health.remote?.rtspSessions) health.remote.rtspSessions.active = 0;
      }
      const other = {
        ...camera,
        id: 'camera.entry',
        playbackSource: { platform: 'mqtt', manufacturer: 'Aqara' },
      };
      f.registry.cameras.push(other);
      f.registry.states.push({
        entity_id: 'sensor.entry_p2p_rtsp_stream',
        state: 'rtsp://192.168.4.45:8556/live',
      });
      await f.sessions.touch(camera, owner, true);
      await f.sessions.touch(other, owner + '-entry', true);
      assert.deepEqual(
        requests.filter((call) => call.path === '/v1/cameras/sessions').map((call) => call.node),
        ['a', 'b'],
      );
      assert.equal(f.sessions.nodeReservations.size, 0);
    } finally {
      await f.cleanup();
    }
  });

  it('unsupported or weak nodes return truthful no-NVR status; previews never wake battery or offline cameras', async () => {
    const f = await createSessionsFixture();
    try {
      for (const health of f.cluster.health.values()) {
        if (health.remote?.rtspSessions) health.remote.rtspSessions.max = 0;
      }
      assert.equal((await f.sessions.touch(camera, owner, true)).reason, 'camera_nvr_required');
      assert.equal(
        (await f.sessions.touch({ ...camera, batteryPowered: true }, owner, true, true)).reason,
        'camera_battery_preview_disabled',
      );
      assert.equal(
        (await f.sessions.touch({ ...camera, available: false }, owner, true)).reason,
        'camera_unavailable',
      );
      assert.equal(f.calls.length, 0);
    } finally {
      await f.cleanup();
    }
  });
});
