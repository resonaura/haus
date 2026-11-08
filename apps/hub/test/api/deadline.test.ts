/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { listen, port, closeServer } from '../support/http.js';
import { test, onTestFinished } from 'vitest';
import { createServer } from 'node:http';
import { nodeRequest } from '@haus/servers';

test('media header deadline releases an unresponsive node but allows a slow body once headers arrive', async () => {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const server = createServer((req, res) => {
    if (req.url === '/stuck') return;
    res.writeHead(200, { 'Content-Length': 4 });
    res.flushHeaders();
    timers.push(setTimeout(() => res.end('clip'), 600));
  });
  await listen(server);
  onTestFinished(async () => {
    timers.forEach(clearTimeout);
    server.closeAllConnections();
    await closeServer(server);
  });
  const node = {
    url: `http://127.0.0.1:${port(server)}`,
    key: 'fixture-only-header-deadline-key',
    allowHttp: true,
  };
  await assert.rejects(
    nodeRequest(node, '/stuck', {
      headerTimeout: 300,
      timeout: 2000,
    }),
    { name: 'AbortError' },
  );
  const response = await nodeRequest(node, '/body', {
    headerTimeout: 300,
    timeout: 2000,
  });
  assert.equal(await response.text(), 'clip');
});
