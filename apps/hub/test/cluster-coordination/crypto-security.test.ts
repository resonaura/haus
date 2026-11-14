/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AesGcmCredentialCipher } from '../../src/commissioning/credentials.service.js';
import { ClusterCryptoIdentity } from '../../src/cluster/crypto/identity.js';
import { resolveOrProvisionMasterKey } from '../../src/cluster/crypto/master-key.js';
import { openCatalog } from '../../src/storage/source.js';
import { ClusterStateEntity } from '../../src/storage/cluster/entities.js';
import { createLiveClusterNode } from './harness.js';
import {
  BoundedReplayGuard,
  isNewerWatermark,
  openClusterEnvelope,
  sealClusterEnvelope,
} from '../../src/cluster/crypto/envelope.js';
import {
  buildSignedPeerHeaders,
  ClusterPeerVerifier,
  sha256Hex,
  validateClusterPeerUrl,
} from '../../src/cluster/crypto/transport.js';

describe('Cluster cryptographic isolation, E2EE envelopes & peer security', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('provisions per-hub CSPRNG 0o600 secrets.key and prevents cross-hub decryption without master key', async () => {
    const dirA = await mkdtemp(join(tmpdir(), 'haus-key-a-'));
    const dirB = await mkdtemp(join(tmpdir(), 'haus-key-b-'));
    dirs.push(dirA, dirB);

    const prevEnv = process.env.HAUS_CREDENTIAL_KEY;
    delete process.env.HAUS_CREDENTIAL_KEY;
    try {
      const keyA = resolveOrProvisionMasterKey({ dataDir: dirA });
      const keyB = resolveOrProvisionMasterKey({ dataDir: dirB });
      expect(keyA.length).toBe(32);
      expect(keyB.length).toBe(32);
      expect(Buffer.compare(keyA, keyB)).not.toBe(0);

      const fileStat = await stat(join(dirA, 'secrets.key'));
      expect(fileStat.mode & 0o777).toBe(0o600);

      // Re-reading yields the identical provisioned key
      expect(Buffer.compare(resolveOrProvisionMasterKey({ dataDir: dirA }), keyA)).toBe(0);

      // No hardcoded fallback key exists across hubs
      const cipherA = new AesGcmCredentialCipher(undefined, { dataDir: dirA });
      const cipherB = new AesGcmCredentialCipher(undefined, { dataDir: dirB });
      const sealed = await cipherA.encrypt(
        Buffer.from(JSON.stringify({ apiSecret: 'super-secret-123' })),
      );
      expect(JSON.parse(Buffer.from(await cipherA.decrypt(sealed)).toString('utf8'))).toEqual({
        apiSecret: 'super-secret-123',
      });
      await expect(cipherB.decrypt(sealed)).rejects.toThrow();
    } finally {
      if (prevEnv !== undefined) process.env.HAUS_CREDENTIAL_KEY = prevEnv;
    }
  });

  it('seals/opens X25519+AES-GCM+Ed25519 envelopes and blocks tampering, wrong recipient, forgery, replay & rollback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-env-'));
    dirs.push(dir);
    const sender = ClusterCryptoIdentity.loadOrCreate('hub-sender', join(dir, 'sender'));
    const receiver = ClusterCryptoIdentity.loadOrCreate('hub-recv', join(dir, 'recv'));
    const attacker = ClusterCryptoIdentity.loadOrCreate('hub-attacker', join(dir, 'attacker'));
    const guard = new BoundedReplayGuard();

    const secretPayload = { apiKey: 'ak-999', refreshToken: 'rt-confidential-value' };
    const env = sealClusterEnvelope({
      identity: sender,
      homeId: 'home-1',
      recipientHubId: 'hub-recv',
      recipientExchangePublicKey: receiver.exchangePublicKey,
      kind: 'credential',
      resourceId: 'cred:entry-1',
      revision: 3,
      generation: 2,
      epoch: 5,
      payload: secretPayload,
    });

    expect(env.ciphertext).not.toContain('rt-confidential-value');

    // Valid open succeeds
    const opened = openClusterEnvelope({
      identity: receiver,
      expectedHomeId: 'home-1',
      senderSigningPublicKey: sender.signingPublicKey,
      envelope: env,
      replayGuard: guard,
      minExpectedEpoch: 4,
    });
    expect(opened.payload).toEqual(secretPayload);

    // Replay of same nonce MUST fail
    expect(() =>
      openClusterEnvelope({
        identity: receiver,
        expectedHomeId: 'home-1',
        senderSigningPublicKey: sender.signingPublicKey,
        envelope: env,
        replayGuard: guard,
      }),
    ).toThrow(/replay/);

    // Fresh sealed envelope checks:
    const freshEnv = sealClusterEnvelope({
      identity: sender,
      homeId: 'home-1',
      recipientHubId: 'hub-recv',
      recipientExchangePublicKey: receiver.exchangePublicKey,
      kind: 'credential',
      resourceId: 'cred:entry-1',
      revision: 4,
      generation: 2,
      epoch: 5,
      payload: secretPayload,
    });

    // Wrong homeId or wrong recipient
    expect(() =>
      openClusterEnvelope({
        identity: receiver,
        expectedHomeId: 'home-other',
        senderSigningPublicKey: sender.signingPublicKey,
        envelope: freshEnv,
      }),
    ).toThrow();
    expect(() =>
      openClusterEnvelope({
        identity: attacker,
        expectedHomeId: 'home-1',
        senderSigningPublicKey: sender.signingPublicKey,
        envelope: freshEnv,
      }),
    ).toThrow();

    // Wrong sender signature / forged metadata / tampered ciphertext
    expect(() =>
      openClusterEnvelope({
        identity: receiver,
        expectedHomeId: 'home-1',
        senderSigningPublicKey: attacker.signingPublicKey,
        envelope: freshEnv,
      }),
    ).toThrow();
    expect(() =>
      openClusterEnvelope({
        identity: receiver,
        expectedHomeId: 'home-1',
        senderSigningPublicKey: sender.signingPublicKey,
        envelope: { ...freshEnv, revision: 99 },
      }),
    ).toThrow();
    const badByte = freshEnv.ciphertext.slice(0, -4) + (freshEnv.ciphertext.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() =>
      openClusterEnvelope({
        identity: receiver,
        expectedHomeId: 'home-1',
        senderSigningPublicKey: sender.signingPublicKey,
        envelope: { ...freshEnv, ciphertext: badByte },
      }),
    ).toThrow();

    // Expired TTL rejected
    const expiredEnv = sealClusterEnvelope({
      identity: sender,
      homeId: 'home-1',
      recipientHubId: 'hub-recv',
      recipientExchangePublicKey: receiver.exchangePublicKey,
      kind: 'config',
      resourceId: 'cfg',
      revision: 1,
      generation: 1,
      epoch: 5,
      payload: { a: 1 },
      now: Date.now() - 600_000,
      ttlMs: 1000,
    });
    expect(() =>
      openClusterEnvelope({
        identity: receiver,
        expectedHomeId: 'home-1',
        senderSigningPublicKey: sender.signingPublicKey,
        envelope: expiredEnv,
      }),
    ).toThrow(/expired/);

    // Monotonic watermark blocks rollback revisions/epochs
    expect(isNewerWatermark({ epoch: 5, generation: 2, revision: 2 }, { epoch: 5, generation: 2, revision: 3 })).toBe(false);
    expect(isNewerWatermark({ epoch: 4, generation: 99, revision: 99 }, { epoch: 5, generation: 1, revision: 1 })).toBe(false);
    expect(isNewerWatermark({ epoch: 6, generation: 1, revision: 1 }, { epoch: 5, generation: 99, revision: 99 })).toBe(true);
  });

  it('blocks SSRF metadata/link-local/userinfo URLs and rejects tampered/replayed signed peer RPCs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-rpc-'));
    dirs.push(dir);
    const sender = ClusterCryptoIdentity.loadOrCreate('hub-a', join(dir, 'a'));
    const verifier = new ClusterPeerVerifier();
    const channelSecret = 'sec-0123456789abcdef0123456789abcdef';

    for (const badUrl of [
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0:8098',
      'http://[fe80::1]:8098',
      'http://user:pass@127.0.0.1:8098',
      'http://127.0.0.1:8098/api/shell',
      'ftp://127.0.0.1:8098',
    ]) {
      expect(() => validateClusterPeerUrl(badUrl, true)).toThrow();
    }
    expect(validateClusterPeerUrl('http://127.0.0.1:8098/', true)).toBe('http://127.0.0.1:8098');
    expect(() => validateClusterPeerUrl('http://192.168.1.50:8098', false)).toThrow();

    const body = Buffer.from(JSON.stringify({ ok: true }));
    const headers = buildSignedPeerHeaders({
      identity: sender,
      recipientHubId: 'hub-b',
      homeId: 'home-1',
      method: 'POST',
      path: '/api/cluster/peer/sync',
      bodyBytes: body,
      channelSecret,
    });
    const trust = {
      hubId: 'hub-a',
      homeId: 'home-1',
      signingPublicKey: sender.signingPublicKey,
      channelSecret,
      revoked: false,
    };

    const valid = verifier.verify({
      localHubId: 'hub-b',
      localHomeId: 'home-1',
      method: 'POST',
      path: '/api/cluster/peer/sync',
      headers,
      bodyDigestHex: sha256Hex(body),
      lookupPeer: (id) => (id === 'hub-a' ? trust : undefined),
    });
    expect(valid.ok).toBe(true);

    // Replay same signed HTTP nonce rejected
    const replayed = verifier.verify({
      localHubId: 'hub-b',
      localHomeId: 'home-1',
      method: 'POST',
      path: '/api/cluster/peer/sync',
      headers,
      bodyDigestHex: sha256Hex(body),
      lookupPeer: (id) => (id === 'hub-a' ? trust : undefined),
    });
    expect(replayed.ok).toBe(false);

    // Tampered body or revoked peer rejected
    const headers2 = buildSignedPeerHeaders({
      identity: sender,
      recipientHubId: 'hub-b',
      homeId: 'home-1',
      method: 'POST',
      path: '/api/cluster/peer/sync',
      bodyBytes: body,
      channelSecret,
    });
    expect(
      verifier.verify({
        localHubId: 'hub-b',
        localHomeId: 'home-1',
        method: 'POST',
        path: '/api/cluster/peer/sync',
        headers: headers2,
        bodyDigestHex: sha256Hex('{"tampered":true}'),
        lookupPeer: () => trust,
      }).ok,
    ).toBe(false);

    const headers3 = buildSignedPeerHeaders({
      identity: sender,
      recipientHubId: 'hub-b',
      homeId: 'home-1',
      method: 'POST',
      path: '/api/cluster/peer/sync',
      bodyBytes: body,
      channelSecret,
    });
    expect(
      verifier.verify({
        localHubId: 'hub-b',
        localHomeId: 'home-1',
        method: 'POST',
        path: '/api/cluster/peer/sync',
        headers: headers3,
        bodyDigestHex: sha256Hex(body),
        lookupPeer: () => ({ ...trust, revoked: true }),
      }).ok,
    ).toBe(false);
  });

  it('allows reversing empty ClusterCoordination migration cleanly and blocks destructive rollback once data exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-cluster-mig-'));
    dirs.push(dir);
    const source = await openCatalog(join(dir, 'catalog.sqlite'));
    try {
      await source.undoLastMigration({ transaction: 'all' });
      await source.runMigrations({ transaction: 'all' });

      await source.manager.save(ClusterStateEntity, {
        id: 1,
        hubId: 'hub-a',
        homeId: 'home-1',
        role: 'coordinator',
        coordinatorEpoch: 1,
        coordinatorId: 'hub-a',
        fenced: false,
        updatedAt: Date.now(),
      });

      await expect(source.undoLastMigration({ transaction: 'all' })).rejects.toThrow(
        'cluster_coordination_rollback_requires_explicit_data_migration',
      );
      expect(await source.manager.findOneBy(ClusterStateEntity, { id: 1 })).toBeTruthy();
    } finally {
      await source.destroy();
    }
  });

  it('attaches a separate Hub purely via HTTP POST /api/cluster/attach with grant validation and conflict guards', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-http-coord', role: 'coordinator' });
    const secondary = await createLiveClusterNode({ hubId: 'hub-http-sec', role: 'coordinator' });
    try {
      const challengeRes = await fetch(`${coord.url}/api/auth/challenge`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${coord.apiToken}`,
        },
        body: JSON.stringify({}),
      });
      expect(challengeRes.status).toBe(201);
      const challenge = (await challengeRes.json()) as { sessionId: string; challengeCode: string };

      const confirmRes = await fetch(`${coord.url}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          challengeCode: challenge.challengeCode,
          client: { clientId: secondary.hubId, clientName: 'HTTP Secondary', role: 'node' },
          expectedHomeId: coord.homeId,
        }),
      });
      expect(confirmRes.status).toBe(201);
      const confirmed = (await confirmRes.json()) as { grant: Record<string, unknown> };

      const attachRes = await fetch(`${secondary.url}/api/cluster/attach`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secondary.apiToken}`,
        },
        body: JSON.stringify({
          coordinatorUrl: coord.url,
          selfUrl: secondary.url,
          coordinatorToken: coord.apiToken,
          roles: ['storage', 'stream'],
          grant: confirmed.grant,
        }),
      });
      const attachBody = (await attachRes.json()) as {
        status?: string;
        coordinatorHubId?: string;
        homeId?: string;
        error?: string;
      };
      expect({ status: attachRes.status, body: attachBody }).toMatchObject({
        status: 201,
        body: {
          status: 'joined',
          coordinatorHubId: coord.hubId,
          homeId: coord.homeId,
        },
      });

      expect(secondary.stateStore.getStateSync().role).toBe('node');
      expect(secondary.stateStore.getStateSync().coordinatorId).toBe(coord.hubId);
      expect(secondary.stateStore.getPeerTrustRecord(coord.hubId)?.revoked).toBe(false);
      expect(coord.stateStore.getPeerTrustRecord(secondary.hubId)?.revoked).toBe(false);

      const reattachRes = await fetch(`${secondary.url}/api/cluster/attach`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secondary.apiToken}`,
        },
        body: JSON.stringify({
          coordinatorUrl: coord.url,
          selfUrl: secondary.url,
          coordinatorToken: coord.apiToken,
          grant: confirmed.grant,
        }),
      });
      expect(reattachRes.status).toBe(409);
    } finally {
      await secondary.close();
      await coord.close();
    }
  });
});
