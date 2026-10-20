import { expect, it } from 'vitest';
import { createDemoSnapshot } from '../../model';
import { cameraSource, genericCameraInput, sourceEntities } from './camera-sources';
it('links only URL-bearing source entities and makes safe HA state templates', () => {
  const snapshot = createDemoSnapshot();
  snapshot.states = [
    {
      entity_id: 'sensor.stream',
      state: 'rtsp://192.168.1.30/live',
      attributes: {},
      last_changed: '',
    },
    { entity_id: 'sensor.temperature', state: '24', attributes: {}, last_changed: '' },
    {
      entity_id: 'input_text.snapshot',
      state: 'https://camera.local/frame.jpg',
      attributes: {},
      last_changed: '',
    },
  ];
  expect(sourceEntities(snapshot, 'stream').map((state) => state.entity_id)).toEqual([
    'sensor.stream',
    'input_text.snapshot',
  ]);
  expect(sourceEntities(snapshot, 'snapshot').map((state) => state.entity_id)).toEqual([
    'input_text.snapshot',
  ]);
  expect(cameraSource('', 'sensor.stream', 'stream', snapshot)).toBe(
    "{{ states('sensor.stream') }}",
  );
  expect(() => cameraSource('', "sensor.stream');malicious", 'stream', snapshot)).toThrow();
  expect(() => cameraSource('file:///etc/passwd', '', 'stream', snapshot)).toThrow();
  expect(cameraSource('', '', 'snapshot', snapshot)).toBeUndefined();
});
it('honours current HA generic schemas with a section or older flat options', () => {
  const step = {
    type: 'form',
    flow_id: 'fixture',
    handler: 'generic',
    data_schema: [{ name: 'advanced' }],
  };
  expect(genericCameraInput(step, { stream: 'rtsp://camera.local/live' })).toEqual({
    stream_source: 'rtsp://camera.local/live',
    advanced: { framerate: 2, verify_ssl: true, rtsp_transport: 'tcp', authentication: 'basic' },
  });
  expect(
    genericCameraInput(
      { ...step, data_schema: [{ name: 'verify_ssl' }] },
      { snapshot: 'http://camera.local/still' },
    ),
  ).toEqual({ still_image_url: 'http://camera.local/still', verify_ssl: true });
});
