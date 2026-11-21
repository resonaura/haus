/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { ClusterCryptoIdentity } from '../../src/cluster/crypto/identity.js';
import {
  openPeerNvrAccess,
  sealPeerNvrAccess,
} from '../../src/cluster/coordination/nvr-peer.js';
import { stripNodeSecrets } from '../../src/cluster/nodes.js';
import { createSessionsFixture, owner } from '../camera/sessions-fixture.js';
import type { LocalCameraNode } from '../../src/camera/sessions/types.js';

describe('Cluster peer NVR access E2EE exchange & local fallback', () => {
  it('seals and opens NVR key over E2EE only for the intended trusted peer', () => {
    const miku = ClusterCryptoIdentity.loadOrCreate('hub-miku-worker-01');
    const pi = ClusterCryptoIdentity.loadOrCreate('hub-standalone-01');
    const nvrKey = 'n'.repeat(48);

    const env = sealPeerNvrAccess({
      identity: miku,
      homeId: 'home-default',
      epoch: 2,
      recipientHubId: pi.hubId,
      recipientExchangePublicKey: pi.exchangePublicKey,
      nvrKey,
      roles: ['storage', 'stream'],
    });
    expect(env).toBeDefined();

    const opened = openPeerNvrAccess({
      identity: pi,
      expectedHomeId: 'home-default',
      expectedSenderHubId: miku.hubId,
      senderSigningPublicKey: miku.signingPublicKey,
      peerUrl: 'http://192.168.5.117:8792',
      envelope: env!,
      minExpectedEpoch: 2,
    });
    expect(opened).toEqual({
      key: nvrKey,
      allowHttp: true,
      roles: ['storage', 'stream'],
    });

    // Rejects sender mismatch
    const wrongSender = openPeerNvrAccess({
      identity: pi,
      expectedHomeId: 'home-default',
      expectedSenderHubId: 'hub-other',
      senderSigningPublicKey: miku.signingPublicKey,
      peerUrl: 'http://192.168.5.117:8792',
      envelope: env!,
    });
    expect(wrongSender).toBeUndefined();
  });

  it('strips internal NVR key from public cluster node DTOs', () => {
    const clean = stripNodeSecrets({
      id: 'hub-miku-worker-01',
      name: 'Miku',
      url: 'http://192.168.5.117:8792',
      key: 'secret-nvr-key-value-should-not-leak',
      allowHttp: true,
    });
    expect('key' in clean).toBe(false);
    expect(clean.name).toBe('Miku');
    expect(clean.allowHttp).toBe(true);
  });

  it('falls back to localNode when a cluster peer lacks an NVR key instead of returning camera_nvr_required', async () => {
    const local: LocalCameraNode = {
      node: {
        id: 'local-camera-runtime',
        url: 'http://127.0.0.1:8790',
        key: 'k'.repeat(32),
        enabled: true,
        roles: ['stream'],
      },
      advertiseAddress: '192.168.4.44',
      status: () => ({ profile: 1, webrtc: true, recording: true, max: 4, active: 0 }),
    };
    const fixture = await createSessionsFixture({ localNode: local });
    try {
      // Simulate a peer added by StandaloneClusterService without an NVR key.
      fixture.nodes.splice(0, fixture.nodes.length, {
        id: 'hub-miku-worker-01',
        url: 'http://192.168.5.117:8792',
        key: '',
        enabled: true,
        roles: ['storage', 'stream'],
      });
      fixture.cluster.health.set('hub-miku-worker-01', { online: false });
      const camera = fixture.registry.cameras[0];

      const warm = await fixture.sessions.touch(camera, owner, true);
      expect(warm).toMatchObject({ warm: true, transport: 'nvr-webrtc' });
      expect(fixture.calls[0]?.node).toBe(local.node.id);
    } finally {
      await fixture.cleanup();
    }
  });
});
