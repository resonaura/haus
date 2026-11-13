/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { detectTuyaCameraCandidates } from './tuya-cameras';

describe('Tuya camera follow-up candidate detection', () => {
  it('flags Tuya camera entities bound to the entry so TuyaCameraFollowup prompts user', () => {
    const detection = detectTuyaCameraCandidates({
      entryId: 'entry_tuya_1',
      entities: [
        {
          entity_id: 'camera.kitchen_cam',
          config_entry_id: 'entry_tuya_1',
          device_id: 'tuya:cam_1',
          original_name: 'Kitchen Cam',
        },
      ],
      devices: [
        {
          id: 'tuya:cam_1',
          name: 'Kitchen Cam',
          config_entries: ['entry_tuya_1'],
        },
      ],
      pairedProviders: [],
      discoveredProviders: [],
    });

    expect(detection.hasEntryEntities).toBe(true);
    expect(detection.shouldPrompt).toBe(true);
    expect(detection.cameras).toEqual([
      { id: 'tuya:cam_1', name: 'Kitchen Cam', source: 'ha_entity', imported: false },
    ]);
  });
});
