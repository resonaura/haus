/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect } from 'vitest';
import { normalizeHome, type Snapshot } from '../../model';
import { defaults } from '../../model/preferences';
import { buildHomeView } from '../../model/home-view';
import { buildRoomDeviceCandidates, mergeRoomIcons } from './room-candidates';

function sampleSnapshot(): Snapshot {
  return {
    states: [
      {
        entity_id: 'light.kitchen_main',
        state: 'on',
        last_changed: '2026-11-13T00:00:00Z',
        attributes: { friendly_name: 'Kitchen Ceiling', brightness: 180 },
      },
      {
        entity_id: 'switch.hidden_room_plug',
        state: 'off',
        last_changed: '2026-11-13T00:00:00Z',
        attributes: { friendly_name: 'Secret Plug' },
      },
    ],
    services: {},
    config: { location_name: 'Haus', unit_system: { temperature: '°C' } },
    user: { id: 'u1', name: 'Admin', is_owner: true, is_admin: true },
    areas: [
      { area_id: 'kitchen', name: 'Kitchen' },
      { area_id: 'spalnya', name: 'Спальня', icon: 'bed' } as Snapshot['areas'][number],
      { area_id: 'closet', name: 'Closet' },
    ],
    devices: [
      {
        id: 'dev-kitchen',
        name: 'Kitchen Light',
        manufacturer: 'Hue',
        model: 'Panel',
        area_id: 'kitchen',
        name_by_user: null,
        disabled_by: null,
      },
      {
        id: 'dev-hidden',
        name: 'Hidden Plug',
        area_id: 'closet',
        name_by_user: null,
        disabled_by: null,
      },
      {
        id: 'dev-unassigned-1',
        name: 'Floor Lamp',
        manufacturer: 'IKEA',
        model: 'Tradfri',
        area_id: null,
        name_by_user: 'Corner Lamp',
        disabled_by: null,
      },
      {
        id: 'dev-unassigned-2',
        name: 'Desk Fan',
        manufacturer: 'Dyson',
        area_id: null,
        name_by_user: null,
        disabled_by: null,
      },
    ],
    entities: [
      { entity_id: 'light.kitchen_main', device_id: 'dev-kitchen', area_id: null },
      { entity_id: 'switch.hidden_room_plug', device_id: 'dev-hidden', area_id: null },
    ],
  };
}

describe('Room candidates and empty room navigation', () => {
  it('includes empty user-created rooms in navigationRooms while keeping all-hidden rooms hidden', () => {
    const snapshot = sampleSnapshot();
    const model = normalizeHome(snapshot);
    const view = buildHomeView({
      model,
      snapshot,
      preferences: { ...defaults, hiddenApp: ['switch.hidden_room_plug'] },
      route: { kind: 'home' },
      search: '',
      selectedLightGroup: null,
    });

    expect(view.navigationRooms.map((r) => r.id)).toEqual(['kitchen', 'spalnya']);
    expect(view.homeRooms.map((r) => r.id)).toEqual(['kitchen']);
  });

  it('orders unassigned candidate devices first and filters by name, brand, or current room', () => {
    const snapshot = sampleSnapshot();

    const allForSpalnya = buildRoomDeviceCandidates(snapshot, 'spalnya');
    expect(allForSpalnya.map((c) => c.id)).toEqual([
      'dev-unassigned-1',
      'dev-unassigned-2',
      'dev-hidden',
      'dev-kitchen',
    ]);
    expect(allForSpalnya[0]).toMatchObject({
      name: 'Corner Lamp',
      detail: 'IKEA · Tradfri',
      currentAreaId: null,
      currentRoomName: 'Unassigned',
    });

    const filteredByRoom = buildRoomDeviceCandidates(snapshot, 'spalnya', 'kitchen');
    expect(filteredByRoom.map((c) => c.id)).toEqual(['dev-kitchen']);
  });

  it('merges area icon defaults beneath user preferences', () => {
    const snapshot = sampleSnapshot();
    expect(mergeRoomIcons(snapshot.areas, { spalnya: 'sparkles', kitchen: 'coffee' })).toEqual({
      spalnya: 'sparkles',
      kitchen: 'coffee',
    });
    expect(mergeRoomIcons(snapshot.areas)).toEqual({ spalnya: 'bed' });
  });
});
