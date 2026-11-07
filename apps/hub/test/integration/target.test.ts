/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { remoteTarget } from './support/remote.js';

const environment = {
  HAUS_NVR_TEST_URL: 'http://127.0.0.1:8098',
  HAUS_NVR_TEST_KEY_FILE: resolve('disposable-fixture.key'),
};
it('does not enable external writes merely because an origin and credential path are configured', () => {
  expect(remoteTarget(environment)).toBeUndefined();
  expect(remoteTarget({ ...environment, HAUS_NVR_TEST_DISPOSABLE: '0' })).toBeUndefined();
});
it('rejects ambiguous origins and incomplete disposable-target configuration', () => {
  for (const url of [
    'file:///tmp/fixture',
    'http://user:password@127.0.0.1',
    'http://127.0.0.1/path',
    'http://127.0.0.1/?key=secret',
    'http://127.0.0.1/#fragment',
  ])
    expect(() =>
      remoteTarget({ ...environment, HAUS_NVR_TEST_DISPOSABLE: '1', HAUS_NVR_TEST_URL: url }),
    ).toThrow();
  expect(() => remoteTarget({ HAUS_NVR_TEST_DISPOSABLE: '1' })).toThrow();
  expect(() =>
    remoteTarget({
      ...environment,
      HAUS_NVR_TEST_DISPOSABLE: '1',
      HAUS_NVR_TEST_KEY_FILE: 'relative.key',
    }),
  ).toThrow();
});
it('keeps granted media and signed requests on the provisioned origin', () => {
  const target = remoteTarget({ ...environment, HAUS_NVR_TEST_DISPOSABLE: '1' });
  expect(target?.url('/v1/blobs/fixture?grant=scoped').href).toBe(
    'http://127.0.0.1:8098/v1/blobs/fixture?grant=scoped',
  );
  expect(target?.url('/media/' + 'a'.repeat(64) + '?signature=scoped').origin).toBe(
    'http://127.0.0.1:8098',
  );
  for (const path of [
    '//elsewhere/v1/status',
    'https://elsewhere/v1/status',
    '/v1/../../outside',
    '/v1/\\elsewhere/status',
    '/v1/status#fragment',
  ])
    expect(() => target?.url(path)).toThrow();
});
