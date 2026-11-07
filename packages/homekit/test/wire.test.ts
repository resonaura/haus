/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { mediaCommand } from '../src/wire.js';

const context = {
  cameraId: 'camera.one',
  sessionId: 'a'.repeat(36),
  address: '127.0.0.1',
  owner: 'fixture-owner-123456789',
};
it('decodes owned HomeKit wire commands without converting invalid fields into defaults', () => {
  expect(mediaCommand({ ...context, action: 'snapshot' })).toEqual({
    ...context,
    action: 'snapshot',
  });
  expect(
    mediaCommand({ ...context, action: 'configure', generation: 2, configuration: null }),
  ).toMatchObject({ generation: 2, configuration: null });
  expect(mediaCommand({ ...context, action: 'lease', sessionID: 'session' })).toMatchObject({
    sessionID: 'session',
  });
  const video = {
    width: 320,
    height: 180,
    fps: 15,
    profile: 0,
    level: 0,
    max_bit_rate: 500,
    pt: 99,
    mtu: 1200,
  };
  const audio = { codec: 'OPUS', sample_rate: 24, pt: 110, max_bit_rate: 32, packet_time: 20 };
  expect(
    mediaCommand({ ...context, action: 'start', request: { sessionID: 'stream', video, audio } }),
  ).toMatchObject({ request: { video, audio } });
  for (const value of [
    null,
    [],
    { ...context, action: 'snapshot', owner: 42 },
    { ...context, action: 'start', request: {} },
    { ...context, action: 'configure', generation: NaN, configuration: null },
    { ...context, action: 'unknown' },
  ])
    expect(() => mediaCommand(value)).toThrow(/invalid_homekit_/);
});
