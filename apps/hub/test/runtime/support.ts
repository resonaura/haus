/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Capacity } from '@haus/ai';
import { HostTelemetry } from '@haus/servers';
import { MediaRuntime } from '@haus/media/pipeline';
import { vi } from 'vitest';
import type { NvrDependencies } from '../../src/runtime/nvr.js';
export const key = 'isolated-runtime-fixture-key-at-least-32-bytes';
export function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export function dependencies() {
  const capacity = new Capacity({ read: async () => '', cpus: 2, memory: 1024 ** 3 });
  const host = new HostTelemetry({ container: true });
  host.value = { scope: 'host', sampledAt: new Date().toISOString() };
  const initialize = vi.spyOn(host, 'initialize').mockResolvedValue(host);
  const hostStop = vi.spyOn(host, 'stop');
  const capacityStop = vi.spyOn(capacity, 'stop');
  const spawn = vi.fn(() => {
    throw Error('unexpected_media_process');
  });
  const diagnostic = vi.fn();
  const ports: NvrDependencies = {
    media: new MediaRuntime({ spawnProcess: spawn }),
    capacity: () => capacity,
    telemetry: () => host,
    diagnostic,
  };
  return { ports, host, capacity, initialize, hostStop, capacityStop, spawn, diagnostic };
}
export const environment = (root: string): NodeJS.ProcessEnv => ({
  HAUS_DATA: root,
  HAUS_DATA_DIR: root,
  HAUS_NODE_KEY: key,
  HAUS_ROLES: '',
  PORT: '0',
  HAUS_BIND_ADDRESS: '127.0.0.1',
});
