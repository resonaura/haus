import { expect, it, vi } from 'vitest';
import type { HausNative } from '../../../shared/native';
import { loadLastLightOutput } from './light-history';

it('reads full light attributes, supports compressed history and stops querying resolved lights', async () => {
  const resolved = new Set<string>();
  const onState = vi.fn((state) => resolved.add(state.entity_id));
  const request = vi.fn().mockResolvedValueOnce({
    'light.bed': [
      { s: 'on', a: { brightness: 150, rgb_color: [128, 64, 255] }, lu: 1792195200 },
      { s: 'off', a: { brightness: null }, lu: 1792195300 },
    ],
  });
  await loadLastLightOutput(
    { request } as Pick<HausNative, 'request'>,
    ['light.bed'],
    (id) => !resolved.has(id),
    onState,
    1792220000000,
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toMatchObject({
    type: 'history/history_during_period',
    entity_ids: ['light.bed'],
    no_attributes: false,
    minimal_response: false,
  });
  expect(onState).toHaveBeenCalledWith(
    expect.objectContaining({
      entity_id: 'light.bed',
      state: 'on',
      attributes: { brightness: 150, rgb_color: [128, 64, 255] },
    }),
  );
});
