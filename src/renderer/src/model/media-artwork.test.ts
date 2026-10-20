import { expect, it } from 'vitest';
import { mediaArtwork } from './media-artwork';
import type { HausAccessory } from './types';
function tv(manufacturer?: string, model?: string): HausAccessory {
  return {
    id: 'media_player.tv',
    primaryEntityId: 'media_player.tv',
    entityIds: ['media_player.tv'],
    name: 'Michael TV',
    category: 'media',
    availability: 'available',
    capabilities: [],
    state: { entity_id: 'media_player.tv', state: 'idle', attributes: {}, last_changed: '' },
    secondaryEntities: [],
    manufacturer,
    model,
  };
}
it('uses Samsung TV artwork for Samsung and DLNA model metadata, even with a custom accessory name', () => {
  const samsung = mediaArtwork(tv('Samsung'));
  expect(samsung).toContain('viewBox="0 0 64 50"');
  expect(mediaArtwork(tv('Samsung Electronics', 'LS43CG702NNXZA'))).toBe(samsung);
  expect(mediaArtwork(tv(undefined, 'LS43CG702NNXZA'))).toBe(samsung);
  expect(mediaArtwork(tv('Another manufacturer'))).toBeUndefined();
});
