import { describe, it, expect } from 'vitest';
import { validateHelperRequest } from './helper';
describe('private Haus recordings bridge', () => {
  it('only permits the timeline, recording controls and known detector settings', () => {
    expect(
      validateHelperRequest({
        method: 'GET',
        path: '/api/events?camera_id=camera.entry&from=1000&limit=60',
      }).path,
    ).toContain('/api/events');
    expect(
      validateHelperRequest({
        method: 'PATCH',
        path: '/api/cameras/camera.entry',
        data: { enabled: true, sensorIds: ['binary_sensor.entry_motion'] },
      }).data,
    ).toEqual({ enabled: true, sensorIds: ['binary_sensor.entry_motion'] });
    expect(
      validateHelperRequest({ method: 'POST', path: '/api/cameras/camera.entry/record', data: {} })
        .method,
    ).toBe('POST');
  });
  it('rejects arbitrary targets, media through JSON, secret fields, and forged detector IDs', () => {
    for (const request of [
      { method: 'GET', path: 'https://other.test/api/status' },
      { method: 'GET', path: '/api/events?access_token=secret' },
      { method: 'GET', path: '/api/events/00000000-0000-0000-0000-000000000000/video' },
      { method: 'PATCH', path: '/api/cameras/camera.entry', data: { token: 'private' } },
      { method: 'PATCH', path: '/api/cameras/camera.entry', data: { sensorIds: ['camera.other'] } },
      { method: 'POST', path: '/api/cameras/camera.entry/record', data: { enabled: false } },
    ])
      expect(() => validateHelperRequest(request)).toThrow();
  });
});

import { createServer } from 'node:http';
import { HausHelper } from './helper';
import type { HomeAssistantConnection } from './connection';
it('streams microphone chunks through the authenticated local helper and stops the session', async () => {
  let receive!: (bytes: Buffer) => void;
  const received = new Promise<Buffer>((resolve) => {
    receive = resolve;
  });
  const server = createServer((req, res) => {
    expect(req.url).toBe('/api/cameras/camera.entry/talk');
    expect(req.headers['x-haus-client']).toBe('1');
    expect(req.headers['content-type']).toContain('audio/webm');
    req.once('data', receive);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.flushHeaders();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const helper = new HausHelper({
    request: async () => ({
      addons: [{ slug: 'local_haus-helper', name: 'Haus', state: 'started' }],
    }),
    addonSurface: async () => ({ url: `http://127.0.0.1:${address.port}/` }),
  } as unknown as HomeAssistantConnection);
  try {
    const ready = helper.startTalk('camera.entry');
    helper.writeTalk(new Uint8Array([26, 69, 223, 163]));
    await ready;
    expect(await received).toEqual(Buffer.from([26, 69, 223, 163]));
    helper.stopTalk();
    expect(() => helper.writeTalk(new Uint8Array([1]))).toThrow('not active');
  } finally {
    helper.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
