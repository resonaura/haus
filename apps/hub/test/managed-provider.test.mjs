/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectManagedProvider } from '../lib/managed-provider.mjs';
test('managed pairing keeps its code local and requires Supervisor proof plus matching local identity', async () => {
  const id = randomUUID(),
    code = 'a'.repeat(48),
    paths = [];
  const hint = {
    bridgeId: id,
    provider: 'aqara',
    url: 'http://172.30.32.1:8580',
    source: 'supervisor',
    managed: true,
  };
  let added;
  const options = {
    discover: async () => [hint],
    local: async (port, path) => {
      assert.equal(port, 8580);
      paths.push(path);
      return path.endsWith('/info') ? { version: 2, bridgeId: id, provider: 'aqara' } : { code };
    },
  };
  const providers = {
    add: async (input) => {
      added = input;
      return { id };
    },
  };
  assert.deepEqual(await connectManagedProvider({ token: 'ha-private' }, providers, id, options), {
    id,
  });
  assert.deepEqual(added, { url: hint.url, code, allowHttp: true });
  assert.deepEqual(paths, ['/api/haus/v2/info', '/api/haus/v2/pairing']);
  paths.length = 0;
  await assert.rejects(
    connectManagedProvider({ token: 'private' }, providers, id, {
      ...options,
      discover: async () => [{ ...hint, source: 'mdns' }],
    }),
    /unavailable/,
  );
  assert.deepEqual(paths, []);
  paths.length = 0;
  await assert.rejects(
    connectManagedProvider({ token: 'private' }, providers, id, {
      ...options,
      local: async (_port, path) => {
        paths.push(path);
        return { version: 2, bridgeId: randomUUID(), provider: 'aqara' };
      },
    }),
    /identity/,
  );
  assert.deepEqual(paths, ['/api/haus/v2/info']);
});
