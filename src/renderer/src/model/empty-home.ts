import type { Snapshot } from './types';

/** Real-home bootstrap has no fictional rooms, devices or administrator identity. */
export function createEmptySnapshot(): Snapshot {
  return {
    states: [],
    areas: [],
    devices: [],
    entities: [],
    services: {},
    config: { location_name: 'Home' },
    user: { name: '', is_admin: false },
  };
}
