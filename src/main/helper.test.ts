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
