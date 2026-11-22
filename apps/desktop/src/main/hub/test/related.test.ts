/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { projectHubRules } from '../management/hub-rules-projection';
import { searchHubRelated } from '../management/hub-related';

describe('searchHubRelated', () => {
  it('isolates sibling button entities while matching colon-delimited Hub device IDs', () => {
    const view = {
      states: [],
      entities: [
        { entity_id: 'event.dial_button_1', device_id: 'hue:bridge:001788:dial-1' },
        { entity_id: 'event.dial_button_2', device_id: 'hue:bridge:001788:dial-1' },
      ],
      devices: [{ id: 'hue:bridge:001788:dial-1' }],
      areas: [],
      bindings: new Map([
        [
          'event.dial_button_1',
          {
            deviceId: 'hue:bridge:001788:dial-1',
            endpointId: 'ep:dial:btn1',
            domain: 'event',
            capability: { id: 'button_event', kind: 'event', operations: ['read'] },
          },
        ],
        [
          'event.dial_button_2',
          {
            deviceId: 'hue:bridge:001788:dial-1',
            endpointId: 'ep:dial:btn2',
            domain: 'event',
            capability: { id: 'button_event', kind: 'event', operations: ['read'] },
          },
        ],
      ]),
    };
    const projected = projectHubRules({
      view,
      scenes: [],
      scripts: [],
      automations: [
        {
          id: 'rule-btn1',
          name: 'Dial Button 1 Toggle',
          enabled: true,
          triggers: [{ type: 'state', endpointId: 'ep:dial:btn1' }],
          actions: [],
        },
        {
          id: 'rule-dev',
          name: 'Dial Device Trigger',
          enabled: true,
          triggers: [],
          actions: [],
          metadata: {
            haConfig: {
              triggers: [{ trigger: 'device', device_id: 'hue:bridge:001788:dial-1' }],
            },
          },
        },
      ],
      now: '2026-11-22T00:00:00Z',
    });

    const devMatches = searchHubRelated({
      itemType: 'device',
      itemId: 'hue:bridge:001788:dial-1',
      view,
      projected,
    });
    expect(devMatches.automation).toEqual([
      'automation.dial_button_1_toggle',
      'automation.dial_device_trigger',
    ]);

    expect(
      searchHubRelated({
        itemType: 'entity',
        itemId: 'event.dial_button_1',
        view,
        projected,
      }),
    ).toEqual({ automation: ['automation.dial_button_1_toggle'] });

    expect(
      searchHubRelated({
        itemType: 'entity',
        itemId: 'event.dial_button_2',
        view,
        projected,
      }),
    ).toEqual({});
  });
});
