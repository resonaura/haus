import { expect, it } from 'vitest';
import { CAMERA_ORDER_SCOPE, cameraOrderPatch, moveCamera, orderCameras } from './camera-order';
import { sanitizePreferences } from './preferences';
import { sharedPreferences } from './shared-preferences';
import type { HassEntity } from './types';
const cameras = ['a', 'b', 'c'].map((entity_id) => ({ entity_id }) as HassEntity);

it('keeps camera order stable as live states change and appends newly discovered cameras', () => {
  expect(orderCameras(cameras, ['c', 'a']).map((camera) => camera.entity_id)).toEqual([
    'c',
    'a',
    'b',
  ]);
  expect(
    orderCameras([...cameras, { entity_id: 'new' } as HassEntity], ['b', 'c', 'a']).map(
      (camera) => camera.entity_id,
    ),
  ).toEqual(['b', 'c', 'a', 'new']);
  expect(cameras.map((camera) => camera.entity_id)).toEqual(['a', 'b', 'c']);
});

it('previews a move without mutating the source or accepting another collection drag', () => {
  const ids = ['a', 'b', 'c'];
  expect(moveCamera(ids, 'a', 'c')).toEqual(['b', 'c', 'a']);
  expect(moveCamera(ids, 'other-device', 'b')).toEqual(ids);
  expect(ids).toEqual(['a', 'b', 'c']);
});

it('retains hidden and missing IDs in their slots when the visible collection is moved', () => {
  expect(
    cameraOrderPatch(
      ['a', 'hidden', 'b', 'offline', 'c'],
      ['a', 'b', 'c', 'new'],
      ['c', 'a', 'b', 'new'],
    ),
  ).toEqual(['c', 'hidden', 'a', 'offline', 'b', 'new']);
  expect(cameraOrderPatch(['a', 'hidden', 'b'], ['a', 'hidden', 'b'], ['b', 'a'])).toEqual([
    'b',
    'hidden',
    'a',
  ]);
});

it('persists camera ordering through existing preference sanitization and helper sync', () => {
  const preferences = sanitizePreferences({
    deviceOrder: { [CAMERA_ORDER_SCOPE]: ['c', 'a', 'b'] },
  });
  expect(sharedPreferences(preferences).deviceOrder).toEqual({
    [CAMERA_ORDER_SCOPE]: ['c', 'a', 'b'],
  });
});
