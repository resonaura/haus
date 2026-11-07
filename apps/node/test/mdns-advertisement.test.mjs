/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { nvrMdnsConfiguration, startNvrMdnsAdvertisement } from '@haus/hub/runtime';

test('local discovery stays off by default', async () => {
  let responderCreated = false;
  assert.equal(nvrMdnsConfiguration({}), undefined);
  assert.equal(
    await startNvrMdnsAdvertisement({
      env: {},
      ciao: { getResponder: () => (responderCreated = true) },
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
  let options;
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
        shutdown: async () => shutdowns++,
      }),
    },
  });
  assert.equal(options.type, 'haus-nvr');
  assert.equal(options.port, 8098);
  assert.equal(options.hostname, undefined);
  assert.deepEqual(options.txt, { protocol: '1' });
  assert.deepEqual(options.restrictedAddresses, ['192.168.1.20']);
  assert.equal(options.disabledIpv6, true);
  assert.equal(JSON.stringify(options).includes('must-not-be-advertised'), false);
  assert.equal(JSON.stringify(options).includes('private-node-name'), false);
  await stop();
  await stop();
  assert.equal(shutdowns, 1);
});

test('an invalid host address fails before any socket is opened', async () => {
  let responderCreated = false;
  await assert.rejects(
    startNvrMdnsAdvertisement({
      env: { HAUS_MDNS_ADVERTISE: 'true', HAUS_MDNS_ADDRESS: '203.0.113.10' },
      ciao: { getResponder: () => (responderCreated = true) },
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
      ciao: { getResponder: () => (responderCreated = true) },
    }),
    /assigned to this host network/,
  );
  assert.equal(responderCreated, false);
});
