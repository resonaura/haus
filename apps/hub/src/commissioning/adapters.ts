/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  classifyHomeKitAccessory,
  HAP_PAIRING_SERVICE_UUID,
  type CommissioningAdapter,
  type CommissioningContext,
  type CommissioningResult,
  type ParsedSetupCode,
  type RadioConnection,
} from '@haus/core';
import { computeHomeKitSetupHash, type HapBlePeripheral } from '@haus/homekit';
import type { HomeKitControllerService } from '../homekit/service.js';
import type { MatterService } from '../matter/service.js';
import type { RadioAgentRegistry } from './radio.js';
import type { IpHandoverCoordinator } from './handover.js';

export class HomeKitIpAdapter implements CommissioningAdapter {
  public readonly name = 'homekit';

  constructor(
    private readonly homekit: HomeKitControllerService,
    private readonly radios?: RadioAgentRegistry,
  ) {}

  canHandle(code: ParsedSetupCode): boolean {
    return code.protocol === 'homekit';
  }

  async commission(ctx: CommissioningContext): Promise<CommissioningResult> {
    const pin = ctx.parsedCode.homekit?.pin;
    if (!pin) return { status: 'failed', error: 'homekit_pin_missing' };

    const cand = ctx.candidate as
      | {
          details?: Record<string, unknown>;
          metadata?: Readonly<Record<string, unknown>>;
          discriminator?: number;
          paired?: boolean;
          sourceAgentId?: string;
          agentId?: string;
          domain?: string;
          protocol?: string;
          transport?: string;
          address?: string;
          port?: number;
          identifier?: string;
          name?: string;
          connection?: RadioConnection;
          peripheral?: HapBlePeripheral;
        }
      | undefined;

    // 1. Classify accessory
    const classification = classifyHomeKitAccessory({
      flags: ctx.parsedCode.homekit?.flags,
      transport: cand?.transport ?? (cand?.domain === 'radio' ? 'ble' : undefined),
      serviceType:
        typeof cand?.details?.serviceType === 'string' ? cand.details.serviceType : undefined,
    });

    ctx.emit(
      'homekit.classified',
      'PARSE_CODE',
      `HomeKit accessory classified as ${classification.classification}`,
      {
        classification: classification.classification,
        description: classification.description,
        guidance: classification.guidance,
      },
    );

    // 2. Reject unsupported boundaries
    if (classification.classification === 'wac-only') {
      return {
        status: 'failed',
        error: 'wac_unsupported',
        detail: { message: classification.guidance },
      };
    }
    if (classification.classification === 'vendor-softap') {
      return {
        status: 'failed',
        error: 'vendor_softap_required',
        detail: { message: classification.guidance },
      };
    }

    // 3. Respect existing pairing ownership invariant
    const candDetails = cand?.details ?? {};
    const sf = candDetails.sf ?? candDetails.SF;
    const isPaired =
      cand?.paired === true || sf === '0' || sf === 0 || candDetails.pairingAvailable === false;
    if (isPaired) {
      return {
        status: 'failed',
        error: 'already_paired',
        detail: {
          message:
            'Accessory is already paired to another controller and cannot be paired again without manual factory reset. Haus will never implicitly reset an accessory.',
        },
      };
    }

    // 4. Setup hash matching
    const wantSetupId = ctx.parsedCode.homekit?.setupId?.toUpperCase();
    const candHash =
      (typeof candDetails.setupHash === 'string'
        ? candDetails.setupHash
        : typeof candDetails.sh === 'string'
          ? candDetails.sh
          : undefined) ?? undefined;
    const accessoryId = cand?.identifier ?? (candDetails.id as string | undefined);
    if (wantSetupId && candHash && accessoryId) {
      const expectedHash = computeHomeKitSetupHash(wantSetupId, accessoryId);
      if (expectedHash !== candHash) {
        return {
          status: 'failed',
          error: 'setup_hash_mismatch',
          detail: { expected: expectedHash, received: candHash },
        };
      }
    }

    // 5. Handle BLE vs IP
    const isBle =
      classification.classification === 'hap-ble' ||
      cand?.transport === 'ble' ||
      cand?.domain === 'radio';

    if (isBle) {
      ctx.emit(
        'controller.pairing',
        'FINAL_PAIR',
        'Honest HAP-BLE pairing over Bluetooth LE (no Wi-Fi credentials required)',
      );

      let radioLeaseToken: string | undefined;
      try {
        if (this.radios) {
          const agentId = (cand?.metadata?.sourceAgentId as string | undefined) ?? cand?.agentId;
          if (agentId) {
            const lease = this.radios.grantLease(
              agentId,
              ctx.commissioningId,
              ctx.homeId ?? 'home-default',
            );
            radioLeaseToken = lease?.leaseToken;
          }
        }

        const candidateConn = cand?.connection;
        const candidatePeripheral = cand?.peripheral;

        const peripheral: HapBlePeripheral = candidatePeripheral ?? {
          id: cand?.identifier ?? 'mock-ble-accessory',
          name: cand?.name,
          readCharacteristic: async (uuid: string) => {
            if (candidateConn?.readCharacteristic) {
              return candidateConn.readCharacteristic(HAP_PAIRING_SERVICE_UUID, uuid);
            }
            return new Uint8Array(0);
          },
          writeCharacteristic: async (uuid: string, data: Uint8Array | number[]) => {
            if (candidateConn?.writeCharacteristic) {
              const buf = data instanceof Uint8Array ? data : Uint8Array.from(data);
              await candidateConn.writeCharacteristic(HAP_PAIRING_SERVICE_UUID, uuid, buf);
            }
          },
        };

        const result = await this.homekit.pairBleAccessory(peripheral, pin, cand?.name);
        ctx.emit('controller.verified', 'VERIFY', 'HAP-BLE accessory verified', {
          accessoryId: result.pairing.accessoryId,
        });
        ctx.emit('commission.completed', 'DONE', 'HomeKit BLE commissioning completed', {
          accessoryId: result.pairing.accessoryId,
        });
        return { status: 'completed', devices: result.devices };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          status: 'failed',
          error: msg.includes('already_paired')
            ? 'already_paired'
            : msg.includes('rejected_fed3')
              ? 'rejected_fed3_uuid'
              : err instanceof Error
                ? err.message
                : 'homekit_ble_pairing_failed',
        };
      } finally {
        if (radioLeaseToken && this.radios) {
          this.radios.revokeLease(radioLeaseToken);
        }
      }
    }

    // Standard HAP-IP
    ctx.emit('controller.pairing', 'FINAL_PAIR', 'HomeKit Pair-Setup started over HAP-IP');
    try {
      const result = await this.homekit.pairAccessory({
        pin,
        accessoryId: cand?.identifier,
        address: cand?.address ?? ctx.targetAddress,
        port: cand?.port ?? ctx.targetPort,
        name: cand?.name ?? ctx.targetName,
      });
      ctx.emit('controller.verified', 'VERIFY', 'HomeKit accessory verified', {
        accessoryId: result.pairing.accessoryId,
      });
      ctx.emit('commission.completed', 'DONE', 'HomeKit IP commissioning completed', {
        accessoryId: result.pairing.accessoryId,
      });
      return { status: 'completed', devices: result.devices };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'failed',
        error: msg.includes('already_paired')
          ? 'already_paired'
          : err instanceof Error
            ? err.message
            : 'homekit_pairing_failed',
      };
    }
  }
}

export { HomeKitIpAdapter as HomeKitAdapter };

export class MatterAdapter implements CommissioningAdapter {
  public readonly name = 'matter';

  constructor(
    private readonly matter: MatterService,
    private readonly radios?: RadioAgentRegistry,
    private readonly handover?: IpHandoverCoordinator,
  ) {}

  canHandle(code: ParsedSetupCode): boolean {
    return code.protocol === 'matter';
  }

  async commission(ctx: CommissioningContext): Promise<CommissioningResult> {
    const transport = this.matter.transport;
    if (!transport) return { status: 'failed', error: 'matter_server_not_configured' };
    const payload = ctx.parsedCode.matter;
    if (!payload) return { status: 'failed', error: 'matter_payload_missing' };

    // 1. Commissioning window check and discriminator matching on discovered candidate
    const cand = ctx.candidate as
      | {
          details?: Record<string, unknown>;
          metadata?: Readonly<Record<string, unknown>>;
          discriminator?: number;
          paired?: boolean;
          sourceAgentId?: string;
          agentId?: string;
          domain?: string;
          protocol?: string;
          transport?: string;
          address?: string;
          port?: number;
        }
      | undefined;

    if (cand) {
      const details = cand.details ?? {};
      const cm =
        typeof details.commissioningMode === 'number'
          ? details.commissioningMode
          : details.CM !== undefined
            ? parseInt(String(details.CM), 10)
            : undefined;
      const pairingAvail = details.pairingAvailable as boolean | undefined;
      if (cm === 0 || pairingAvail === false || cand.paired === true) {
        return { status: 'failed', error: 'commissioning_window_expired' };
      }

      const codeDisc = payload.discriminator;
      if (codeDisc) {
        const candDisc =
          cand.discriminator ??
          (typeof details.discriminator === 'number'
            ? details.discriminator
            : details.D !== undefined
              ? parseInt(String(details.D), 10)
              : undefined);
        const candShortDisc =
          typeof details.shortDiscriminator === 'number'
            ? details.shortDiscriminator
            : candDisc !== undefined
              ? (candDisc >> 8) & 0x0f
              : undefined;

        if (candDisc !== undefined) {
          if (codeDisc.type === 'long') {
            if (candDisc !== codeDisc.value) {
              return { status: 'failed', error: 'discriminator_mismatch' };
            }
          } else {
            const candidateShort = (candDisc >> 8) & 0x0f;
            if (candidateShort !== codeDisc.value) {
              return { status: 'failed', error: 'short_discriminator_mismatch' };
            }
          }
        } else if (candShortDisc !== undefined) {
          const codeShort =
            codeDisc.type === 'long' ? (codeDisc.value >> 8) & 0x0f : codeDisc.value;
          if (candShortDisc !== codeShort) {
            return { status: 'failed', error: 'short_discriminator_mismatch' };
          }
        }
      }
    }

    // 2. Off-network vs LAN evaluation & credential requirement
    const caps = payload.discoveryCapabilities;
    const isOffNetwork =
      (caps !== undefined && !caps.onNetwork && (caps.ble || caps.softAp)) ||
      cand?.domain === 'radio' ||
      cand?.protocol === 'matter-ble' ||
      cand?.transport === 'ble' ||
      cand?.transport === 'softap';
    const isThreadDevice =
      ctx.threadDataset !== undefined ||
      cand?.metadata?.networkType === 'thread' ||
      cand?.details?.networkType === 'thread' ||
      cand?.details?.thread === true;

    if (isOffNetwork && !ctx.wifiCredentials && !ctx.threadDataset) {
      return {
        status: 'credentials_required',
        requiresCredentials: {
          kind: isThreadDevice ? 'thread' : 'wifi',
          reason: isThreadDevice
            ? 'Matter Thread device requires Active Operational Dataset for joining Thread network.'
            : 'Matter device is not on LAN; Wi-Fi network credentials required.',
        },
      };
    }

    // 3. Claim radio lease if communicating through a nearby radio agent
    let radioLeaseToken: string | undefined;
    const candidateAgentId = cand?.agentId ?? cand?.sourceAgentId;
    if (isOffNetwork && this.radios && candidateAgentId && candidateAgentId !== 'hub') {
      const agent = this.radios.get(candidateAgentId);
      if (agent) {
        const lease = this.radios.grantLease(
          agent.id,
          ctx.commissioningId,
          ctx.homeId ?? 'home-default',
        );
        radioLeaseToken = lease.leaseToken;
      }
    }

    try {
      // 4. Secure Channel (PASE session)
      ctx.emit('secure_session.started', 'SECURE_CHANNEL', 'Matter PASE session started', {
        discriminator: payload.discriminator?.value,
        failSafeTimeoutSeconds: 60,
      });

      // 5. Network configuration provisioning
      if (ctx.wifiCredentials) {
        ctx.emit('network.provisioning', 'NETWORK_PROVISION', 'Forwarding Wi-Fi credentials', {
          ssid: ctx.wifiCredentials.ssid,
        });
        if (transport.setWifiCredentials) {
          await transport.setWifiCredentials(
            ctx.wifiCredentials.ssid,
            ctx.wifiCredentials.password,
          );
        }
      } else if (ctx.threadDataset) {
        ctx.emit(
          'network.provisioning',
          'NETWORK_PROVISION',
          'Forwarding Thread Active Operational Dataset',
        );
        if (transport.setThreadDataset) {
          await transport.setThreadDataset(ctx.threadDataset);
        }
      }

      // 6. Network handover if off-network (BLE transport drops on network connect, expected!)
      let targetIp = ctx.targetAddress ?? ctx.candidate?.address;
      let targetPort = ctx.targetPort ?? ctx.candidate?.port ?? 5540;

      if (isOffNetwork && this.handover) {
        ctx.emit(
          'device.ip.discovered',
          'WAIT_FOR_IP',
          'Device connecting to IP network; awaiting mDNS operational advertisement',
        );
        try {
          const handoverResult = await this.handover.waitForIp(ctx.commissioningId, {
            protocol: 'matter',
            discriminator: payload.discriminator?.value,
            expectedName: ctx.candidate?.name,
            timeoutMs: 30_000,
          });
          targetIp = handoverResult.address;
          targetPort = handoverResult.port ?? 5540;
          ctx.emit(
            'device.ip.discovered',
            'WAIT_FOR_IP',
            `Operational node discovered on IP network at ${targetIp}:${targetPort}`,
            { address: targetIp, port: targetPort },
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            status: 'failed',
            error: msg.includes('timeout') ? 'network_join_timeout' : 'handover_failed',
          };
        }
      }

      // 7. CASE session & Completion
      ctx.emit(
        'controller.pairing',
        'FINAL_PAIR',
        'Establishing CASE session with operational node',
      );
      const res = await transport.commission({
        code: ctx.parsedCode.raw,
        ip: targetIp,
        port: targetPort,
        discriminator: payload.discriminator?.value,
        passcode: payload.passcode,
        failSafeTimeoutSeconds: 60,
      });

      ctx.emit('controller.verified', 'VERIFY', 'Matter node commissioned and verified', {
        nodeId: res.nodeId,
      });
      ctx.emit('commission.completed', 'DONE', 'Matter commissioning completed', {
        nodeId: res.nodeId,
        fabricIndex: res.fabricIndex,
      });

      await this.matter.refreshNodes();
      return { status: 'completed', detail: { nodeId: res.nodeId } };
    } catch (err: unknown) {
      const errStr = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (
        errStr.includes('window_expired') ||
        errStr.includes('window_closed') ||
        errStr.includes('not_in_commissioning_mode')
      ) {
        return { status: 'failed', error: 'commissioning_window_expired' };
      }
      if (
        errStr.includes('invalid_credentials') ||
        errStr.includes('wifi_connect_failed') ||
        errStr.includes('thread_connect_failed') ||
        errStr.includes('auth_failed')
      ) {
        return { status: 'failed', error: 'invalid_network_credentials' };
      }
      if (errStr.includes('network_join_timeout') || errStr.includes('timeout')) {
        return { status: 'failed', error: 'network_join_timeout' };
      }
      return {
        status: 'failed',
        error: err instanceof Error ? err.message : 'matter_commission_failed',
      };
    } finally {
      if (radioLeaseToken && this.radios) {
        this.radios.revokeLease(radioLeaseToken);
      }
    }
  }
}
