/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { cameraOperating } from '../../src/camera/index.js';

describe('cameraOperating', () => {
  it('Eufy indicator and automatic night vision use exact physical-device registry properties', async () => {
    const commands: Record<string, unknown>[] = [];
    const data = {
      cameras: [{ id: 'camera.side', deviceIds: ['eufy'] }],
      entities: [
        {
          entity_id: 'switch.led',
          device_id: 'eufy',
          platform: 'eufy_security',
          unique_id: 'eufy_security_serial_device_statusLed',
        },
        {
          entity_id: 'switch.ir',
          device_id: 'eufy',
          platform: 'eufy_security',
          unique_id: 'eufy_security_serial_device_autoNightvision',
        },
        {
          entity_id: 'switch.another',
          device_id: 'unrelated',
          platform: 'eufy_security',
          unique_id: 'eufy_security_other_device_statusLed',
        },
      ],
      states: [
        { entity_id: 'switch.led', state: 'on' },
        { entity_id: 'switch.ir', state: 'off' },
        { entity_id: 'switch.another', state: 'on' },
      ],
    };
    const ha = {
      connected: true,
      request: async (command: Record<string, unknown>) => {
        commands.push(command);
        setTimeout(() => {
          data.states[1].state = 'on';
        }, 20);
      },
    };
    const source = cameraOperating({ registry: () => data, ha });
    assert.deepEqual(source.read('camera.side'), {
      indicator: { id: 'switch.led', available: true, value: true },
      nightVision: { id: 'switch.ir', available: true, value: false },
    });
    await source.write('camera.side', 'nightVision', 'switch.ir', true);
    assert.equal(source.read('camera.side').nightVision?.value, true);
    assert.deepEqual(commands, [
      {
        type: 'call_service',
        domain: 'switch',
        service: 'turn_on',
        service_data: { entity_id: 'switch.ir' },
      },
    ]);
    await assert.rejects(
      source.write('camera.side', 'indicator', 'switch.another', false),
      /unavailable/,
    );
    ha.connected = false;
    assert.equal(source.read('camera.side').indicator?.available, false);
    await assert.rejects(
      source.write('camera.side', 'indicator', 'switch.led', false),
      /unavailable/,
    );
  });
});
