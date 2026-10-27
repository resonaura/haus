import type { HausAccessory } from './types';

/** One projection of existing devices; no copies/renames of their HA identities. */
export function activeLights(items: HausAccessory[]) {
  return items.filter(
    (item) =>
      item.category === 'lights' && item.availability === 'available' && item.state.state === 'on',
  );
}
