/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  IMPROV_CHARACTERISTICS,
  IMPROV_SERVICE_UUID,
  ImprovState,
  chunkImprovPacket,
  encodeImprovWifiCommand,
  type Advertisement,
  type CommissioningAdapter,
  type CommissioningContext,
  type CommissioningResult,
  type ParsedSetupCode,
  type RadioAgent,
} from '@haus/core';
import type { RadioAgentRegistry } from './radio.js';

export class ImprovBleAdapter implements CommissioningAdapter {
  public readonly name = 'improv-ble';

  constructor(
    private readonly radios: RadioAgentRegistry,
    private readonly scanMs = 8000,
  ) {}

  canHandle(code: ParsedSetupCode): boolean {
    return code.protocol === 'improv';
  }

  async commission(ctx: CommissioningContext): Promise<CommissioningResult> {
    const agents = this.radios.list();
    if (agents.length === 0) return { status: 'failed', error: 'no_radio_agent_available' };
    if (!ctx.wifiCredentials) {
      return {
        status: 'credentials_required',
        requiresCredentials: { kind: 'wifi', reason: 'Improv device needs Wi-Fi credentials.' },
      };
    }
    const hint = ctx.parsedCode.improv?.deviceNameHint?.toLowerCase();
    const found = await this.scan(ctx, agents, hint);
    if (!found) return { status: 'failed', error: 'improv_device_not_found' };

    ctx.emit('secure_session.started', 'SECURE_CHANNEL', 'Connecting to Improv device');
    const connection = await found.agent.connect({
      agentId: found.agent.id,
      identifier: found.adv.identifier,
      transport: 'ble',
    });
    try {
      const done = new Promise<'ok' | 'error'>((resolve) => {
        const timer = setTimeout(() => resolve('error'), 30_000);
        void connection.subscribeCharacteristic(
          IMPROV_SERVICE_UUID,
          IMPROV_CHARACTERISTICS.currentState,
          (data) => {
            if (data[0] === ImprovState.provisioned) {
              clearTimeout(timer);
              resolve('ok');
            }
          },
        );
      });
      ctx.emit('network.provisioning', 'NETWORK_PROVISION', 'Sending Wi-Fi settings');
      const packet = encodeImprovWifiCommand(
        ctx.wifiCredentials.ssid,
        ctx.wifiCredentials.password,
      );
      for (const chunk of chunkImprovPacket(packet)) {
        await connection.writeCharacteristic(
          IMPROV_SERVICE_UUID,
          IMPROV_CHARACTERISTICS.rpcCommand,
          chunk,
        );
      }
      if ((await done) !== 'ok') return { status: 'failed', error: 'improv_provisioning_failed' };
      ctx.emit('network.provisioned', 'WAIT_FOR_IP', 'Device joined Wi-Fi');
      return { status: 'completed', detail: { identifier: found.adv.identifier } };
    } finally {
      await connection.close();
    }
  }

  private async scan(
    ctx: CommissioningContext,
    agents: RadioAgent[],
    hint: string | undefined,
  ): Promise<{ agent: RadioAgent; adv: Advertisement } | undefined> {
    ctx.emit('discovery.radio.started', 'RADIO_DISCOVERY', 'Scanning for Improv BLE devices');
    const results = await Promise.all(
      agents.map(async (agent) => {
        const deadline = Date.now() + this.scanMs;
        for await (const adv of agent.scan({
          commissioningId: ctx.commissioningId,
          kind: 'improv',
          timeoutMs: this.scanMs,
          serviceUuids: [IMPROV_SERVICE_UUID],
        })) {
          if (!hint || adv.name.toLowerCase().includes(hint)) return { agent, adv };
          if (Date.now() > deadline) break;
        }
        return undefined;
      }),
    );
    return results.find((r) => r !== undefined);
  }
}
