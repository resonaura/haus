/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { listen, port, closeServer } from '../support/http.js';
import { test } from 'vitest';
import { EventEmitter, once } from 'node:events';
import WebSocket from 'ws';
import { createApi } from '@haus/hub/runtime';
import { openTestRecordingStore } from '../support/recording.js';
import { SharedConfig } from '@haus/hub/preferences';
import { openTestCatalog } from '../support/catalog.js';

test('authenticated clients receive immediate revisions and HA outages without losing the home channel', async () => {
  const store = await openTestRecordingStore(':memory:', '/tmp');
  const catalog = await openTestCatalog(':memory:');
  const shared = new SharedConfig(catalog.transactions),
    ha = Object.assign(new EventEmitter(), { connected: true });
  await shared.ready;
  const server = createApi({
    config: { standalone: true, apiToken: 'fixture' },
    ha,
    store,
    shared,
    recorder: {},
    getRegistry: () => ({ cameras: [] }),
    servers: null,
  });
  const clients: WebSocket[] = [];
  await listen(server);
  const url = `ws://127.0.0.1:${port(server)}/api/live`;
  const open = async (token = 'fixture') => {
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-Haus-Client': '1' },
    });
    clients.push(socket);
    const [, message] = await Promise.all([once(socket, 'open'), once(socket, 'message')]);
    return { socket, initial: JSON.parse(message[0]) };
  };
  try {
    const [a, b] = await Promise.all([open(), open()]);
    assert.equal(a.initial.revision, '0');
    assert.equal(a.initial.instance, b.initial.instance);
    const updates = clients.map((socket) => once(socket, 'message'));
    const saved = await shared.patch('0', { favorites: ['light.narnia'] });
    for (const pending of updates) {
      const value = JSON.parse((await pending)[0]);
      assert.equal(value.revision, saved.revision);
      assert.equal(value.topic, 'preferences');
      assert.ok(!JSON.stringify(value).includes('light.narnia'));
    }
    const outage = once(a.socket, 'message');
    ha.connected = false;
    ha.emit('status', 'Reconnecting');
    assert.equal(JSON.parse((await outage)[0]).connected, false);
    assert.equal(a.socket.readyState, WebSocket.OPEN);
    const changedOffline = once(a.socket, 'message');
    await shared.patch(saved.revision, { roomIcons: { narnia: 'moon' } });
    assert.equal(JSON.parse((await changedOffline)[0]).topic, 'preferences');
    const closed = once(a.socket, 'close');
    a.socket.send(JSON.stringify({ type: 'command' }));
    assert.equal((await closed)[0], 1008);
    await assert.rejects(open('wrong'));
  } finally {
    for (const socket of clients) socket.terminate();
    await closeServer(server);
    await catalog.close();
    await store.close();
  }
});
