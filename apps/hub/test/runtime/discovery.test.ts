/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi, test } from 'vitest';
import { nvrMdnsConfiguration, startNvrMdnsAdvertisement } from '../../src/runtime/discovery.js';
import { deferred } from './support.js';
import assert from 'node:assert/strict';
import { required, record } from '../nvr/support/values.js';
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

test('local discovery stays off by default', async () => {
  let responderCreated = false;
  assert.equal(nvrMdnsConfiguration({}), undefined);
  assert.equal(
    await startNvrMdnsAdvertisement({
      env: {},
      ciao: {
        getResponder: () => {
          responderCreated = true;
          throw Error('unexpected_responder');
        },
      },
    }),
    undefined,
  );
  assert.equal(responderCreated, false);
});

test('only explicit private IPv4 host addresses are advertised', () => {
  assert.deepEqual(
    nvrMdnsConfiguration({
      HAUS_MDNS_ADVERTISE: 'true',
      HAUS_MDNS_ADDRESS: '192.168.1.20, 10.0.0.8, 192.168.1.20',
    }),
    { addresses: ['192.168.1.20', '10.0.0.8'] },
  );
  for (const address of ['', '127.0.0.1', '169.254.2.1', '100.64.1.1', '8.8.8.8', 'fd00::2']) {
    assert.throws(
      () =>
        nvrMdnsConfiguration({
          HAUS_MDNS_ADVERTISE: '1',
          HAUS_MDNS_ADDRESS: address,
        }),
      /private IPv4 addresses/,
    );
  }
});

test('advertisement exposes only the service version and shuts down once', async () => {
  let options: unknown;
  let shutdowns = 0;
  const stop = await startNvrMdnsAdvertisement({
    env: {
      HAUS_MDNS_ADVERTISE: 'true',
      HAUS_MDNS_ADDRESS: '192.168.1.20',
      HAUS_NODE_KEY: 'must-not-be-advertised',
      HAUS_NODE_ID: 'private-node-name',
    },
    port: 8098,
    getLocalAddresses: () => new Set(['192.168.1.20']),
    ciao: {
      getResponder: () => ({
        createService: (value) => {
          options = value;
          return { advertise: async () => undefined };
        },
        shutdown: async () => {
          shutdowns++;
        },
      }),
    },
  });
  assert.equal(record(options).type, 'haus-nvr');
  assert.equal(record(options).port, 8098);
  assert.equal(record(options).hostname, undefined);
  assert.deepEqual(record(options).txt, { protocol: '1' });
  assert.deepEqual(record(options).restrictedAddresses, ['192.168.1.20']);
  assert.equal(record(options).disabledIpv6, true);
  assert.equal(JSON.stringify(options).includes('must-not-be-advertised'), false);
  assert.equal(JSON.stringify(options).includes('private-node-name'), false);
  await required(stop)();
  await required(stop)();
  assert.equal(shutdowns, 1);
});

test('an invalid host address fails before any socket is opened', async () => {
  let responderCreated = false;
  await assert.rejects(
    startNvrMdnsAdvertisement({
      env: { HAUS_MDNS_ADVERTISE: 'true', HAUS_MDNS_ADDRESS: '203.0.113.10' },
      ciao: {
        getResponder: () => {
          responderCreated = true;
          throw Error('unexpected_responder');
        },
      },
    }),
    /private IPv4 addresses/,
  );
  assert.equal(responderCreated, false);
});

test('a private address not assigned to this host is never advertised', async () => {
  let responderCreated = false;
  await assert.rejects(
    startNvrMdnsAdvertisement({
      env: { HAUS_MDNS_ADVERTISE: 'true', HAUS_MDNS_ADDRESS: '192.168.1.99' },
      getLocalAddresses: () => new Set(['192.168.1.20']),
      ciao: {
        getResponder: () => {
          responderCreated = true;
          throw Error('unexpected_responder');
        },
      },
    }),
    /assigned to this host network/,
  );
  assert.equal(responderCreated, false);
});
