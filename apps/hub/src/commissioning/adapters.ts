/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  CommissioningAdapter,
  CommissioningContext,
  CommissioningResult,
  ParsedSetupCode,
} from '@haus/core';
import type { HomeKitControllerService } from '../homekit/service.js';
import type { MatterService } from '../matter/service.js';

export class HomeKitIpAdapter implements CommissioningAdapter {
  public readonly name = 'homekit-ip';

  constructor(private readonly homekit: HomeKitControllerService) {}

  canHandle(code: ParsedSetupCode): boolean {
    return code.protocol === 'homekit';
  }

  async commission(ctx: CommissioningContext): Promise<CommissioningResult> {
    const pin = ctx.parsedCode.homekit?.pin;
    if (!pin) return { status: 'failed', error: 'homekit_pin_missing' };
    const candidate = ctx.candidate;
    ctx.emit('controller.pairing', 'FINAL_PAIR', 'HomeKit Pair-Setup started');
    try {
      const result = await this.homekit.pairAccessory({
        pin,
        accessoryId: candidate?.identifier,
        address: candidate?.address ?? ctx.targetAddress,
        port: candidate?.port ?? ctx.targetPort,
        name: candidate?.name ?? ctx.targetName,
      });
      ctx.emit('controller.verified', 'VERIFY', 'HomeKit accessory verified', {
        accessoryId: result.pairing.accessoryId,
      });
      return { status: 'completed', devices: result.devices };
    } catch (err: unknown) {
      return {
        status: 'failed',
        error: err instanceof Error ? err.message : 'homekit_pairing_failed',
      };
    }
  }
}

export class MatterAdapter implements CommissioningAdapter {
  public readonly name = 'matter';

  constructor(private readonly matter: MatterService) {}

  canHandle(code: ParsedSetupCode): boolean {
    return code.protocol === 'matter';
  }

  async commission(ctx: CommissioningContext): Promise<CommissioningResult> {
    const payload = ctx.parsedCode.matter;
    if (!payload) return { status: 'failed', error: 'matter_payload_missing' };
    const caps = payload.discoveryCapabilities;
    const needsNetwork = caps !== undefined && !caps.onNetwork && (caps.ble || caps.softAp);
    if (needsNetwork && !ctx.wifiCredentials && !ctx.threadDataset) {
      return {
        status: 'credentials_required',
        requiresCredentials: {
          kind: 'wifi',
          reason: 'Matter code carries no network credentials; device is not on the LAN yet.',
        },
      };
    }
    try {
      ctx.emit('secure_session.started', 'SECURE_CHANNEL', 'Matter commissioning started');
      if (ctx.wifiCredentials) {
        ctx.emit('network.provisioning', 'NETWORK_PROVISION', 'Forwarding Wi-Fi credentials');
        await this.matter.transport.setWifiCredentials(
          ctx.wifiCredentials.ssid,
          ctx.wifiCredentials.password,
        );
      }
      const res = await this.matter.transport.commission({ code: ctx.parsedCode.raw });
      ctx.emit('commission.completed', 'VERIFY', 'Matter node commissioned', {
        nodeId: res.nodeId,
      });
      await this.matter.refreshNodes();
      return { status: 'completed', detail: { nodeId: res.nodeId } };
    } catch (err: unknown) {
      return {
        status: 'failed',
        error: err instanceof Error ? err.message : 'matter_commission_failed',
      };
    }
  }
}
