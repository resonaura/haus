/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { EntityActionQueue } from '../model/optimistic';
import { dispatchQueuedAction, shouldReloadHomeForLiveEvent } from './action-coalesce';

describe('renderer action coalescing and Hub live reload suppression', () => {
  it('coalesces waiting light slider actions orthogonally while preserving toggle and scene FIFO barriers', async () => {
    const queue = new EntityActionQueue();
    const sent: Array<{ service: string; data?: Record<string, unknown> }> = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let first = true;

    const send = async (action: Parameters<typeof dispatchQueuedAction>[1]) => {
      if (first) {
        first = false;
        await firstGate;
      }
      sent.push({ service: action.service, data: action.service_data });
      return { context: { id: `ctx-${sent.length}` } };
    };

    const target = { entity_id: 'light.office_lamp' };
    const p0 = dispatchQueuedAction(
      queue,
      { domain: 'light', service: 'turn_on', target, service_data: { brightness_pct: 10 } },
      send,
    );
    const p1 = dispatchQueuedAction(
      queue,
      { domain: 'light', service: 'turn_on', target, service_data: { rgb_color: [255, 0, 0] } },
      send,
    );
    const p2 = dispatchQueuedAction(
      queue,
      { domain: 'light', service: 'turn_on', target, service_data: { brightness_pct: 80 } },
      send,
    );
    const p3 = dispatchQueuedAction(
      queue,
      { domain: 'light', service: 'turn_on', target, service_data: { color_temp_kelvin: 4000 } },
      send,
    );
    const pToggle = dispatchQueuedAction(
      queue,
      { domain: 'light', service: 'toggle', target },
      send,
    );
    const pStep = dispatchQueuedAction(
      queue,
      { domain: 'light', service: 'turn_on', target, service_data: { brightness_step_pct: -15 } },
      send,
    );

    releaseFirst();
    await Promise.all([p0, p1, p2, p3, pToggle, pStep]);

    expect(sent).toEqual([
      { service: 'turn_on', data: { brightness_pct: 10 } },
      { service: 'turn_on', data: { brightness_pct: 80, color_temp_kelvin: 4000 } },
      { service: 'toggle', data: undefined },
      { service: 'turn_on', data: { brightness_step_pct: -15 } },
    ]);
  });

  it('suppresses full reload storms for Hub device live events while preserving scene/app/HA reloads', () => {
    const hubSession = { url: 'http://hub.local', name: 'Hub', kind: 'haus-hub' as const };
    const haSession = { url: 'http://ha.local', name: 'HA' };
    const devicesEvent = {
      type: 'helper-live' as const,
      scope: 'http://hub.local',
      online: true,
      topic: 'devices' as const,
    };
    const scenesEvent = { ...devicesEvent, topic: 'scenes' as const };

    expect(shouldReloadHomeForLiveEvent(devicesEvent, hubSession)).toBe(false);
    expect(shouldReloadHomeForLiveEvent(scenesEvent, hubSession)).toBe(true);
    expect(shouldReloadHomeForLiveEvent(devicesEvent, haSession)).toBe(true);
  });
});
