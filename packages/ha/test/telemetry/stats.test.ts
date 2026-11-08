/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { test, vi, type TestContext } from 'vitest';
import assert from 'node:assert/strict';
import { HostTelemetry } from '../../src/node/host-telemetry.js';

const unexpected = () => {
  throw Error('unexpected_fixture_io');
};
function create(context: TestContext, fetcher: typeof fetch = async () => unexpected()) {
  const telemetry = new HostTelemetry(
    { standalone: false, media: '/isolated-fixture-media' },
    {
      fetcher,
      read: async () => unexpected(),
      list: async () => unexpected(),
      filesystem: async () => unexpected(),
      serviceCounters: { collect: async () => unexpected(), snapshot: unexpected, stop: vi.fn() },
    },
  );
  context.onTestFinished(() => telemetry.stop());
  return telemetry;
}
async function percent(telemetry: HostTelemetry, path: string) {
  const sample = await telemetry.stats(path);
  assert.ok(sample);
  return sample.cpu_percent;
}

test('one-shot Supervisor counters measure container CPU across polls without adding request latency', async (t) => {
  let sample: Record<string, unknown> = {
    cpu_usage: 100,
    cpu_system_usage: 1000,
    online_cpus: 4,
    cpu_percent: null,
  };
  const calls: string[] = [];
  const telemetry = create(t, async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url.pathname + url.search);
    return Response.json({ result: 'ok', data: sample });
  });
  assert.equal(await percent(telemetry, '/core/stats'), null);
  sample = { ...sample, cpu_usage: 125, cpu_system_usage: 2000 };
  assert.equal(await percent(telemetry, '/core/stats'), 2.5);
  assert.deepEqual(calls, ['/core/stats?one_shot=true', '/core/stats?one_shot=true']);
  sample = { ...sample, cpu_usage: 1, cpu_system_usage: 3000 };
  assert.equal(await percent(telemetry, '/core/stats'), null);
  assert.equal(await percent(telemetry, '/core/stats'), null);
  sample = { cpu_percent: null, memory_usage: 2000 };
  assert.equal(await percent(telemetry, '/core/stats'), null);
  sample = { cpu_usage: 50, cpu_system_usage: 4000, online_cpus: 4, cpu_percent: null };
  assert.equal(await percent(telemetry, '/core/stats'), null);
  sample = { ...sample, cpu_percent: 3.35 };
  assert.equal(await percent(telemetry, '/core/stats'), 3.35);
});

test('container CPU history is isolated and expires instead of spanning a stale interval', async (t) => {
  const telemetry = create(t, async () =>
    Response.json({
      result: 'ok',
      data: {
        cpu_usage: 200,
        cpu_system_usage: 2000,
        online_cpus: 2,
        cpu_percent: null,
      },
    }),
  );
  telemetry.cpuSamples.set('/core/stats', { usage: 100, system: 1000, at: Date.now() - 61000 });
  assert.equal(await percent(telemetry, '/core/stats'), null);
  assert.equal(await percent(telemetry, '/addons/other/stats'), null);
});

test('Supervisor ready percentages and derived cumulative counters share whole-host CPU units', async (t) => {
  const telemetry = create(t);
  let payload: Record<string, unknown> = { cpu_percent: 25 };
  telemetry.supervisor = async () => payload;
  assert.equal(await percent(telemetry, '/fixture'), 25);
  telemetry.cpuSamples.set('/fixture', { usage: 100, system: 1000, at: Date.now() - 1000 });
  payload = { cpu_percent: null, cpu_usage: 300, cpu_system_usage: 1800, online_cpus: 8 };
  assert.equal(await percent(telemetry, '/fixture'), 25);
  telemetry.cpuSamples.set('/fixture', { usage: 100, system: 1000, at: Date.now() - 1000 });
  payload.online_cpus = 2;
  assert.equal(await percent(telemetry, '/fixture'), 25);
});
