/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createServer } from 'node:net';
import { expect, it } from 'vitest';
import { HausMqttBroker } from '../src/broker.js';

it('closes after an occupied bind without hiding EADDRINUSE and can start again', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  const address = occupied.address();
  if (!address || typeof address === 'string') throw Error('fixture_listener_missing');
  const broker = new HausMqttBroker({ host: '127.0.0.1', port: address.port });
  try {
    await expect(broker.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await expect(broker.close()).resolves.toBeUndefined();
    await expect(Promise.all([broker.close(), broker.close()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );
    await expect(broker.listen()).resolves.toMatchObject({ host: '127.0.0.1', port: address.port });
    await expect(Promise.all([broker.close(), broker.close()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  } finally {
    if (occupied.listening) await new Promise<void>((resolve) => occupied.close(() => resolve()));
    await broker.close();
  }
});
