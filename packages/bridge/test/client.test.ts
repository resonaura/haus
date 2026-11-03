/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { lookup } from 'node:dns/promises';
import { CameraBridgeClient, cameraBridgeEndpoint, type BridgeEndpoint } from '../src/client.js';
import { inventoryRevision } from '../src/protocol.js';

it('pins a consented private endpoint and rejects mixed/public DNS or URL credentials before pairing', async () => {
  const resolve = (async () => [
    { address: '192.168.1.20', family: 4 },
  ]) as unknown as typeof lookup;
  await expect(cameraBridgeEndpoint('http://camera.local', false, resolve)).rejects.toThrow(
    'invalid_bridge_address',
  );
  expect(await cameraBridgeEndpoint('http://camera.local', true, resolve)).toEqual({
    url: 'http://camera.local',
    address: '192.168.1.20',
    family: 4,
    allowHttp: true,
  });
  await expect(
    cameraBridgeEndpoint('https://camera.local', false, (async () => [
      { address: '192.168.1.20', family: 4 },
      { address: '203.0.113.20', family: 4 },
    ]) as unknown as typeof lookup),
  ).rejects.toThrow('invalid_bridge_address');
  for (const url of [
    'http://127.0.0.1',
    'http://169.254.169.254',
    'http://user:password@192.168.1.20',
    'http://192.168.1.20/?token=private',
  ])
    await expect(cameraBridgeEndpoint(url, true, resolve)).rejects.toThrow();
});

it('authenticates inventory identity, keeps the credential out of discovery and never retries commands', async () => {
  const bridgeId = randomUUID(),
    clientId = randomUUID(),
    token = 'a'.repeat(64),
    calls: { path: string; token?: string }[] = [];
  const endpoint: BridgeEndpoint = {
    url: 'http://192.168.1.20:8580',
    address: '192.168.1.20',
    family: 4,
    allowHttp: true,
  };
  const value = { version: 2 as const, provider: 'aqara' as const, bridgeId, cameras: [] };
  const request = async (
    _endpoint: BridgeEndpoint,
    path: string,
    options: { token?: string } = {},
  ) => {
    calls.push({ path, token: options.token });
    if (path.endsWith('/info')) return { version: 2, bridgeId, provider: 'aqara' };
    if (path.endsWith('/enroll')) return { version: 2, bridgeId, clientId, token };
    if (path.endsWith('/inventory')) return { ...value, revision: inventoryRevision(value) };
    throw Error('connection_failed');
  };
  const client = await CameraBridgeClient.enroll(endpoint, 'b'.repeat(48), randomUUID(), request);
  expect(calls.slice(0, 2).map((call) => call.token)).toEqual([undefined, undefined]);
  expect((await client.inventory()).bridgeId).toBe(bridgeId);
  expect(calls.at(-1)?.token).toBe(token);
  await expect(
    client.command('one', 'light', { action: 'set', value: { on: true } }, randomUUID()),
  ).rejects.toThrow('connection_failed');
  expect(calls.filter((call) => call.path.endsWith('/command'))).toHaveLength(1);
  const bad = new CameraBridgeClient(client.connection, async () => ({
    ...value,
    bridgeId: randomUUID(),
    revision: inventoryRevision(value),
  }));
  await expect(bad.inventory()).rejects.toThrow('bridge_identity_mismatch');
});
