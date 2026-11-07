/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { collectorOptions, createHostCollector } from '../../src/runtime/collector.js';
import { dependencies, deferred } from './support.js';
function telemetry() {
  const value = dependencies();
  value.host.value = {
    scope: 'host',
    sampledAt: new Date().toISOString(),
    cpu: { logicalCores: 2, usage: 0.1 },
    memory: { totalBytes: 1000, usedBytes: 200, availableBytes: 800 },
    secret: 'must-not-be-published',
  };
  return value;
}

it('publishes sanitized atomic telemetry and stops the owner after a failed write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-collector-'));
  const ports = telemetry();
  const output = join(root, 'host.json');
  const collector = createHostCollector({ output, once: true, telemetry: ports.host });
  try {
    await collector.start();
    await collector.stop();
    const report = await readFile(output, 'utf8');
    expect(JSON.parse(report).scope).toBe('host');
    expect(report).not.toContain('must-not-be-published');
    expect(ports.hostStop).toHaveBeenCalledTimes(1);
    expect(await readdir(root)).toEqual(['host.json']);
    const failingPorts = telemetry();
    const failing = createHostCollector({ output: root, once: true, telemetry: failingPorts.host });
    await expect(failing.start()).rejects.toThrow();
    await failing.stop();
    expect(failingPorts.hostStop).toHaveBeenCalledTimes(1);
    expect(await readdir(root)).toEqual(['host.json']);
  } finally {
    await collector.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('joins an in-flight sample and does not publish after stopping', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-collector-stop-'));
  const ports = telemetry(),
    gate = deferred();
  const sample = vi.spyOn(ports.host, 'sample').mockImplementation(() => gate.promise);
  const output = join(root, 'host.json');
  const collector = createHostCollector({ output, telemetry: ports.host });
  vi.useFakeTimers();
  try {
    await collector.start();
    const previous = await readFile(output, 'utf8');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sample).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = collector.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    gate.resolve();
    await stopping;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sample).toHaveBeenCalledTimes(1);
    expect(await readFile(output, 'utf8')).toBe(previous);
    expect(ports.hostStop).toHaveBeenCalledTimes(1);
  } finally {
    gate.resolve();
    vi.useRealTimers();
    await collector.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects malformed collector arguments', () => {
  expect(collectorOptions(['--output', '/tmp/fixture.json', '--once'])).toEqual({
    output: '/tmp/fixture.json',
    once: true,
  });
  for (const args of [
    [],
    ['--output'],
    ['--output', '--once'],
    ['--output', 'a', '--output', 'b'],
    ['--output', 'a', '--once', '--once'],
  ])
    expect(() => collectorOptions(args)).toThrow();
});
