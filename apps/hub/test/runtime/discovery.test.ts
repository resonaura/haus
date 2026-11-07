/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { startNvrMdnsAdvertisement } from '../../src/runtime/discovery.js';
import { deferred } from './support.js';
const env = { HAUS_MDNS_ADVERTISE: 'true', HAUS_MDNS_ADDRESS: '192.168.1.20' };
const getLocalAddresses = () => new Set(['192.168.1.20']);

it('cancels pending advertisement and joins one shared responder shutdown', async () => {
  const controller = new AbortController();
  const advertised = deferred(),
    shutdown = deferred(),
    shutdownStarted = deferred();
  const release = vi.fn(async () => {
    shutdownStarted.resolve();
    await shutdown.promise;
  });
  const pending = startNvrMdnsAdvertisement({
    env,
    getLocalAddresses,
    signal: controller.signal,
    ciao: {
      getResponder: () => ({
        createService: () => ({ advertise: () => advertised.promise }),
        shutdown: release,
      }),
    },
  });
  const result = expect(pending).rejects.toThrow('cancelled');
  controller.abort(Error('cancelled'));
  await shutdownStarted.promise;
  expect(release).toHaveBeenCalledTimes(1);
  shutdown.resolve();
  await result;
  advertised.resolve();
  expect(release).toHaveBeenCalledTimes(1);
});

it('shuts down responders even when service creation throws and preserves cleanup failures', async () => {
  const shutdown = vi.fn(async () => {
    throw Error('cleanup_failed');
  });
  const pending = startNvrMdnsAdvertisement({
    env,
    getLocalAddresses,
    ciao: {
      getResponder: () => ({
        createService: () => {
          throw Error('create_failed');
        },
        shutdown,
      }),
    },
  });
  await expect(pending).rejects.toMatchObject({
    message: 'discovery_start_failed',
    errors: [
      expect.objectContaining({ message: 'create_failed' }),
      expect.objectContaining({ message: 'cleanup_failed' }),
    ],
  });
  expect(shutdown).toHaveBeenCalledTimes(1);
});
