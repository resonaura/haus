/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it } from 'vitest';
import { enrollmentStatus } from '../../src/cluster/status.js';
import { fixture } from './fixture.js';

const status = {
  protocol: 1,
  nodeId: 'fixture-node',
  instanceId: 'fixture-process',
  relayOrigin: 'http://127.0.0.1:12345',
  roles: ['storage', 'stream'],
  storage: {
    usedBytes: 10,
    maxBytes: 100,
    availableBytes: 90,
    reservedBytes: 0,
    storageLimitBytes: null,
    verification: { supported: true },
    usage: { version: 1 },
  },
  streams: { active: 0, max: 4 },
  settings: { storageLimitBytes: null },
  playback: { profile: 2, active: 0, max: 2 },
  resources: { cpu: 0.2, cpus: 4, memoryBytes: 1024, pressured: false },
  rtspSessions: { profile: 1, active: 0, max: 4, webrtc: true, recording: true },
  features: {
    cameraContinuity: 1,
    cameraRecordingRecovery: 1,
    cameraAccessPolicy: 1,
    autonomousCameraActivity: 1,
    rtspPeer: true,
    directCameraAccess: true,
  },
  host: { cpu: { usage: 0.2 } },
};

it('preserves validated capabilities and telemetry without coercing foreign fields', () => {
  expect(enrollmentStatus(status)).toBe(status);
});

it.each([
  null,
  { protocol: 2 },
  { nodeId: '' },
  { instanceId: {} },
  { relayOrigin: false },
  { roles: [null] },
  { storage: [] },
  { storage: { usedBytes: -1, maxBytes: 100 } },
  { storage: { usedBytes: 0, maxBytes: Infinity } },
  { storage: { usedBytes: 0, maxBytes: 100, storageLimitBytes: '100' } },
  { storage: { usedBytes: 0, maxBytes: 100, verification: { supported: 1 } } },
  { storage: { usedBytes: 0, maxBytes: 100, usage: { version: false } } },
  { streams: { active: '0', max: 4 } },
  { playback: { profile: 1, active: 0 } },
  { resources: { cpu: 0.2, cpus: 4, memoryBytes: 1, pressured: 'false' } },
  { rtspSessions: { max: 4, recording: 1 } },
  { features: { directCameraAccess: 1 } },
  { settings: { storageLimitBytes: -1 } },
])('rejects malformed known status fields (%j)', (patch) => {
  expect(() => enrollmentStatus(patch === null ? null : { ...status, ...patch })).toThrow(
    'invalid_node_protocol',
  );
});

it('rejects malformed peer telemetry before persisting an enrollment', async (t) => {
  const f = await fixture(t);
  await expect(f.cluster.add(f.input(await f.addPeer({ streams: false })))).rejects.toThrow(
    'invalid_node_protocol',
  );
  expect(f.cluster.nodes()).toEqual([]);
  expect(f.changed).not.toHaveBeenCalled();
});
