/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  ImprovState,
  parseSetupCode,
  type Advertisement,
  type CommissioningContext,
  type RadioAgent,
  type RadioConnection,
} from '@haus/core';
import { ImprovBleAdapter } from '../../src/commissioning/improv.js';
import { RadioAgentRegistry } from '../../src/commissioning/radio.js';

function fakeAgent(writes: Uint8Array[]): RadioAgent {
  const adv: Advertisement = {
    agentId: 'fake',
    transport: 'ble',
    protocol: 'improv',
    identifier: 'AA:BB',
    name: 'Lamp',
  };
  return {
    id: 'fake',
    platform: 'hub',
    async *scan() {
      yield adv;
    },
    async connect(): Promise<RadioConnection> {
      let listener: ((d: Uint8Array) => void) | undefined;
      return {
        device: { agentId: 'fake', identifier: 'AA:BB', transport: 'ble' },
        async writeCharacteristic(_s, _c, data) {
          writes.push(data);
          listener?.(new Uint8Array([ImprovState.provisioned]));
        },
        async readCharacteristic() {
          return new Uint8Array();
        },
        async subscribeCharacteristic(_s, _c, l) {
          listener = l;
          return () => undefined;
        },
        async close() {},
      };
    },
  };
}

function ctx(wifi: boolean): CommissioningContext {
  return {
    commissioningId: 'c1',
    parsedCode: parseSetupCode('improv:Lamp'),
    wifiCredentials: wifi ? { ssid: 'Home', password: 'pw123456' } : undefined,
    emit: () => undefined,
  };
}

describe('ImprovBleAdapter', () => {
  it('fails without radio agents, asks for credentials, then provisions', async () => {
    const radios = new RadioAgentRegistry();
    const adapter = new ImprovBleAdapter(radios, 500);
    expect((await adapter.commission(ctx(true))).error).toBe('no_radio_agent_available');

    const writes: Uint8Array[] = [];
    radios.register(fakeAgent(writes));
    expect((await adapter.commission(ctx(false))).status).toBe('credentials_required');
    const res = await adapter.commission(ctx(true));
    expect(res.status).toBe('completed');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((w) => w.length <= 20)).toBe(true);
  });
});
