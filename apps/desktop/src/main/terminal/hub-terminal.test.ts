/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerTerminalEvent } from '../../shared/terminal';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
  },
}));

import { HausTerminalClient } from '@haus/ipc/client';
import { HubKeyStore } from './hub-key-store';
import { makeHubIdentity, sealServer, startMockHub } from './mock-hub';

describe('Desktop HausTerminalClient Direct Secure IPC Client (haus.terminal.v1)', () => {
  const servers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (servers.length) {
      await servers.pop()?.();
    }
  });

  async function waitForEvent(
    events: ServerTerminalEvent[],
    predicate: (event: ServerTerminalEvent) => boolean,
  ): Promise<ServerTerminalEvent> {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const hit = events.find(predicate);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`Timed out waiting for event. Seen: ${JSON.stringify(events)}`);
  }

  it('completes direct binary E2EE handshake, zero-RTT writeFast, raw Uint8Array output, resize/ack, and exit', async () => {
    const hub = await startMockHub(servers);
    const events: ServerTerminalEvent[] = [];
    const client = new HausTerminalClient(
      () => ({ url: hub.url, token: 'admin-bearer-token' }),
      new HubKeyStore('/tmp/haus-unused'),
      (event) => events.push(event),
    );
    const sessionId = randomUUID();
    await client.open({ sessionId, serverId: 'hub-test-01', cols: 80, rows: 24 });

    const connected = await waitForEvent(
      events,
      (e) => e.type === 'status' && e.state === 'connected',
    );
    expect(connected).toMatchObject({
      type: 'status',
      state: 'connected',
      transport: 'hub',
      scope: 'container',
      hostname: 'miku-hub',
      shell: 'bash',
      relayed: true,
    });

    client.resize(sessionId, 110, 40);
    client.writeFast(sessionId, 'hello-bye');
    const dataEvent = await waitForEvent(events, (e) => e.type === 'data');
    expect(dataEvent.type).toBe('data');
    if (dataEvent.type === 'data') {
      expect(dataEvent.data).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(dataEvent.data).toString('utf8')).toBe('echo:hello-bye');
    }
    client.ack(sessionId, 14);
    const exitEvent = await waitForEvent(events, (e) => e.type === 'exit');
    expect(exitEvent).toMatchObject({ type: 'exit', code: 0 });
    expect(
      hub.receivedFrames.some((f) => f.t === 'resize' && f.cols === 110 && f.rows === 40),
    ).toBe(true);
    client.closeAll();
  });

  it('pins Hub Ed25519 key and blocks unexpected key changes until explicitly trusted', async () => {
    const id1 = makeHubIdentity('hub-pin-01', 'home-pin-01');
    const id2 = makeHubIdentity('hub-pin-01', 'home-pin-01');
    const hub = await startMockHub(servers, { identity: id1 });
    const events: ServerTerminalEvent[] = [];
    const keyStore = new HubKeyStore('/tmp/haus-unused');
    const client = new HausTerminalClient(
      () => ({ url: hub.url, token: 'admin-token' }),
      keyStore,
      (event) => events.push(event),
    );

    const s1 = randomUUID();
    await client.open({ sessionId: s1, serverId: 'hub-pin-01', cols: 80, rows: 24 });
    await waitForEvent(
      events,
      (e) => e.sessionId === s1 && e.type === 'status' && e.state === 'connected',
    );
    client.close(s1);
    expect(hub.getUpgrades()).toBe(1);

    hub.setIdentity(id2);
    const s2 = randomUUID();
    await client.open({ sessionId: s2, serverId: 'hub-pin-01', cols: 80, rows: 24 });
    const hostKey = await waitForEvent(events, (e) => e.sessionId === s2 && e.type === 'host-key');
    expect(hostKey).toMatchObject({ type: 'host-key', changed: true });
    expect(hub.getUpgrades()).toBe(1);

    const offeredFingerprint = hostKey.type === 'host-key' ? hostKey.fingerprint : '';
    const s3 = randomUUID();
    await client.open({
      sessionId: s3,
      serverId: 'hub-pin-01',
      cols: 80,
      rows: 24,
      trustFingerprint: offeredFingerprint,
    });
    await waitForEvent(
      events,
      (e) => e.sessionId === s3 && e.type === 'status' && e.state === 'connected',
    );
    expect(hub.getUpgrades()).toBe(2);
    expect(await keyStore.getPinned('home-pin-01', 'hub-pin-01')).toBe(id2.fingerprintHex);
    client.closeAll();
  });

  it('rejects tampered Ed25519 signatures, malformed unencrypted frames, and corrupted AEAD frames', async () => {
    const badSigHub = await startMockHub(servers, { tamperSignature: true });
    const client1 = new HausTerminalClient(
      () => ({ url: badSigHub.url, token: 'admin-token' }),
      new HubKeyStore('/tmp/haus-unused'),
      () => {},
    );
    await expect(
      client1.open({
        sessionId: randomUUID(),
        serverId: 'hub-test-01',
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow('terminal_hub_signature_invalid');
    expect(badSigHub.getUpgrades()).toBe(0);

    const garbageHub = await startMockHub(servers, {
      onSocket: (socket) => {
        socket.write(Buffer.from('{"t":"ready","unencrypted":true}\n', 'utf8'));
      },
    });
    const garbageEvents: ServerTerminalEvent[] = [];
    const client2 = new HausTerminalClient(
      () => ({ url: garbageHub.url, token: 'admin-token' }),
      new HubKeyStore('/tmp/haus-unused'),
      (e) => garbageEvents.push(e),
    );
    await client2.open({
      sessionId: randomUUID(),
      serverId: 'hub-test-01',
      cols: 80,
      rows: 24,
    });
    const garbageDisc = await waitForEvent(
      garbageEvents,
      (e) => e.type === 'status' && e.state === 'disconnected',
    );
    expect(garbageDisc).toMatchObject({
      type: 'status',
      state: 'disconnected',
      message: expect.stringContaining('invalid encrypted frame'),
    });

    const tamperHub = await startMockHub(servers, {
      onSocket: (socket, ticket) => {
        const frame = sealServer(ticket, {
          t: 'ready',
          cols: 80,
          rows: 24,
          scope: 'host',
          hostname: 'x',
          shell: 'sh',
        });
        frame[frame.length - 1] ^= 0xff;
        socket.write(frame);
      },
    });
    const tamperEvents: ServerTerminalEvent[] = [];
    const client3 = new HausTerminalClient(
      () => ({ url: tamperHub.url, token: 'admin-token' }),
      new HubKeyStore('/tmp/haus-unused'),
      (e) => tamperEvents.push(e),
    );
    await client3.open({
      sessionId: randomUUID(),
      serverId: 'hub-test-01',
      cols: 80,
      rows: 24,
    });
    const tamperDisc = await waitForEvent(
      tamperEvents,
      (e) => e.type === 'status' && e.state === 'disconnected',
    );
    expect(tamperDisc).toMatchObject({
      type: 'status',
      state: 'disconnected',
      message: expect.stringContaining('integrity'),
    });
    client1.closeAll();
    client2.closeAll();
    client3.closeAll();
  });
});
