/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { it, expect, type TestContext } from 'vitest';
import { createServer } from 'node:http';
import { checkHealth } from '../../src/runtime/health.js';
import { runtimeConfig } from '../../src/runtime/config.js';
import { healthProbe } from './process.js';
import { port } from '../nvr/support/values.js';

async function fixture(context: TestContext) {
  let status = 200,
    requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.url !== '/health') {
      res.writeHead(500).end();
      return;
    }
    res.writeHead(status, status === 302 ? { Location: '/unexpected' } : {}).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  context.onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return {
    env: { PORT: String(port(server)), HAUS_BIND_ADDRESS: '127.0.0.1' },
    status(value: number) {
      status = value;
    },
    requests: () => requests,
  };
}

it('retains standalone, NVR and explicit appliance listener defaults', async () => {
  const nvr = { HAUS_NODE_KEY: 'isolated-health-fixture-key-32-characters' };
  expect((await runtimeConfig({})).port).toBe(8790);
  expect((await runtimeConfig(nvr)).port).toBe(8098);
  expect((await runtimeConfig({ PORT: '8099' })).port).toBe(8099);
  await expect(checkHealth({ PORT: '0' })).rejects.toThrow('fixed_port');
});
it('checks the configured listener in standalone and monitoring modes', async (context) => {
  const target = await fixture(context);
  expect(await checkHealth(target.env)).toBe(true);
  expect(
    await checkHealth({
      ...target.env,
      HAUS_NODE_KEY: 'isolated-health-fixture-key-32-characters',
      HAUS_ROLES: '',
    }),
  ).toBe(true);
  expect(target.requests()).toBe(2);
});
it('reports non-success responses and refuses redirected health requests', async (context) => {
  const target = await fixture(context);
  target.status(503);
  expect(await checkHealth(target.env)).toBe(false);
  target.status(302);
  await expect(checkHealth(target.env)).rejects.toThrow();
  expect(target.requests()).toBe(2);
});
it('the compiled CLI exits quietly with the observed healthy/unhealthy status', async (context) => {
  const target = await fixture(context);
  expect(await healthProbe(target.env)).toEqual({ code: 0, stdout: '', stderr: '' });
  target.status(503);
  expect(await healthProbe(target.env)).toEqual({ code: 1, stdout: '', stderr: '' });
}, 15000);
