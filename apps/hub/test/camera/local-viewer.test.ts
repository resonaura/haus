/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { createSessionsFixture, owner } from './sessions-fixture.js';
import type { LocalCameraNode } from '../../src/camera/sessions/types.js';

it('uses the local NVR for viewers while keeping recording and remote ownership separate', async () => {
  const local: LocalCameraNode = {
    node: {
      id: 'local-camera-runtime',
      url: 'http://127.0.0.1:8790',
      key: 'k'.repeat(32),
      enabled: true,
      roles: ['stream'],
    },
    advertiseAddress: '192.168.1.11',
    status: () => ({ profile: 1, webrtc: true, recording: true, max: 2, active: 0 }),
  };
  const fixture = await createSessionsFixture({ localNode: local });
  try {
    const [remote] = fixture.nodes.splice(0);
    const camera = fixture.registry.cameras[0];
    await expect(fixture.sessions.touch(camera, owner, true)).resolves.toMatchObject({
      warm: true,
      transport: 'nvr-webrtc',
    });
    expect(fixture.calls[0]).toMatchObject({
      node: local.node.id,
      method: 'POST',
      path: '/v1/cameras/sessions',
      data: { advertiseHost: local.advertiseAddress, requireAudio: false, preRollSeconds: 0 },
    });
    await expect(fixture.sessions.ensure(camera, fixture.sessions.recordingOwner)).rejects.toThrow(
      'camera_nvr_required',
    );
    expect(fixture.calls).toHaveLength(1);
    await fixture.sessions.touch(camera, owner, false);
    expect(fixture.calls.at(-1)).toMatchObject({ node: local.node.id, method: 'DELETE' });

    fixture.nodes.push(remote);
    fixture.cluster.health.set(remote.id, { online: false });
    await expect(fixture.sessions.touch(camera, owner, true)).resolves.toEqual({
      warm: false,
      reason: 'camera_nvr_required',
    });
    expect(fixture.calls).toHaveLength(2);
  } finally {
    await fixture.cleanup();
  }
});
