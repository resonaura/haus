/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  IMPROV_BLE_CHUNK,
  IMPROV_CHARACTERISTICS,
  IMPROV_SERVICE_UUID,
  ImprovBlePacketReassembler,
  ImprovCommand,
  ImprovError,
  ImprovSerialFrameParser,
  ImprovSerialType,
  ImprovState,
  chunkImprovPacket,
  decodeImprovRpcResult,
  encodeImprovSerialPacket,
  encodeImprovWifiCommand,
  type Advertisement,
  type CommissioningAdapter,
  type CommissioningContext,
  type CommissioningResult,
  type ParsedSetupCode,
  type RadioAgent,
} from '@haus/core';
import type { IpHandoverCoordinator } from './handover.js';
import type { RadioAgentRegistry } from './radio.js';

export interface SerialPortConnection {
  readonly portPath: string;
  write(data: Uint8Array): Promise<void>;
  onData(listener: (chunk: Uint8Array) => void): () => void;
  close(): Promise<void>;
}

export interface SerialPortConnector {
  connect(portPath: string): Promise<SerialPortConnection>;
}

function parseHostFromRedirectUrl(urlStr: string | undefined): string | undefined {
  if (!urlStr) return undefined;
  try {
    const u = new URL(urlStr);
    return u.hostname || undefined;
  } catch {
    return undefined;
  }
}

export class ImprovBleAdapter implements CommissioningAdapter {
  public readonly name = 'improv-ble';
  private readonly handover?: IpHandoverCoordinator;
  private readonly scanMs: number;

  constructor(
    private readonly radios: RadioAgentRegistry,
    handoverOrScanMs?: IpHandoverCoordinator | number,
    scanMs = 8000,
  ) {
    if (typeof handoverOrScanMs === 'number') {
      this.handover = undefined;
      this.scanMs = handoverOrScanMs;
    } else {
      this.handover = handoverOrScanMs;
      this.scanMs = scanMs;
    }
  }

  canHandle(code: ParsedSetupCode): boolean {
    return (
      code.protocol === 'improv' && (!code.improv?.transport || code.improv.transport === 'ble')
    );
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
    const found = await this.resolveCandidate(ctx, hint);
    if (!found) return { status: 'failed', error: 'improv_device_not_found' };

    const lease = await this.radios.grantLease(
      found.agent.id,
      ctx.commissioningId,
      ctx.homeId ?? 'home-default',
    );

    ctx.emit('secure_session.started', 'SECURE_CHANNEL', 'Connecting to Improv BLE device');
    const connection = await found.agent.connect({
      agentId: found.agent.id,
      identifier: found.adv.identifier,
      transport: 'ble',
    });

    try {
      let currentState: number = ImprovState.stopped;
      let redirectUrl: string | undefined;
      let failureReason: string | undefined;
      let disconnected = false;
      const reassembler = new ImprovBlePacketReassembler();

      const outcome = await new Promise<'ok' | 'error'>((resolve) => {
        const timeout = setTimeout(() => {
          if (!failureReason) failureReason = 'improv_provisioning_timeout';
          resolve('error');
        }, 30_000);

        const onDone = (result: 'ok' | 'error') => {
          clearTimeout(timeout);
          resolve(result);
        };

        void connection.subscribeCharacteristic(
          IMPROV_SERVICE_UUID,
          IMPROV_CHARACTERISTICS.errorState,
          (data) => {
            const err = data[0] ?? 0;
            if (err === ImprovError.noError) return;
            if (err === ImprovError.unableToConnect) {
              failureReason = 'invalid_network_credentials';
            } else if (err === ImprovError.notAuthorized) {
              failureReason = 'not_authorized';
            } else if (err === ImprovError.invalidRpc) {
              failureReason = 'invalid_rpc_packet';
            } else if (err === ImprovError.unknownCommand) {
              failureReason = 'unknown_rpc_command';
            } else {
              failureReason = 'improv_provisioning_failed';
            }
            onDone('error');
          },
        );

        void connection.subscribeCharacteristic(
          IMPROV_SERVICE_UUID,
          IMPROV_CHARACTERISTICS.rpcResult,
          (data) => {
            const result = reassembler.append(data);
            if (result && result.command === ImprovCommand.wifiSettings && result.strings[0]) {
              redirectUrl = result.strings[0];
            }
          },
        );

        let credentialsSent = false;
        const sendCredentials = async () => {
          if (credentialsSent) return;
          credentialsSent = true;
          ctx.emit(
            'network.provisioning',
            'NETWORK_PROVISION',
            'Sending Wi-Fi credentials over BLE',
          );
          const packet = encodeImprovWifiCommand(
            ctx.wifiCredentials!.ssid,
            ctx.wifiCredentials!.password,
          );
          for (const chunk of chunkImprovPacket(packet, IMPROV_BLE_CHUNK)) {
            await connection.writeCharacteristic(
              IMPROV_SERVICE_UUID,
              IMPROV_CHARACTERISTICS.rpcCommand,
              chunk,
            );
          }
        };

        const handleStateChange = (nextState: number) => {
          currentState = nextState;
          if (nextState === ImprovState.authorizationRequired) {
            ctx.emit(
              'improv.authorization_required',
              'SECURE_CHANNEL',
              'Physical authorization required on device (e.g. button press)',
            );
          } else if (nextState === ImprovState.authorized) {
            ctx.emit(
              'improv.authorized',
              'SECURE_CHANNEL',
              'Device authorized, transmitting credentials',
            );
            void sendCredentials().catch((e) => {
              failureReason = (e as Error).message;
              onDone('error');
            });
          } else if (nextState === ImprovState.provisioning) {
            ctx.emit(
              'network.provisioning',
              'NETWORK_PROVISION',
              'Device attempting Wi-Fi connection',
            );
          } else if (nextState === ImprovState.provisioned) {
            ctx.emit('network.provisioned', 'WAIT_FOR_IP', 'Device joined Wi-Fi');
            onDone('ok');
          }
        };

        void connection.subscribeCharacteristic(
          IMPROV_SERVICE_UUID,
          IMPROV_CHARACTERISTICS.currentState,
          (data) => {
            const nextState = data[0] ?? 0;
            handleStateChange(nextState);
          },
        );

        // Read initial state to determine if device is authorized or requires physical authorization
        void connection
          .readCharacteristic(IMPROV_SERVICE_UUID, IMPROV_CHARACTERISTICS.currentState)
          .then((raw) => {
            if (raw.length > 0) {
              handleStateChange(raw[0] ?? 0);
            } else {
              handleStateChange(ImprovState.authorized);
            }
          })
          .catch(() => {
            handleStateChange(ImprovState.authorized);
          });
      });

      if (outcome !== 'ok') {
        return { status: 'failed', error: failureReason ?? 'improv_provisioning_failed' };
      }

      // Check disconnect or handover
      disconnected = true;
      let targetIp = parseHostFromRedirectUrl(redirectUrl);
      if (!targetIp && this.handover) {
        ctx.emit('device.ip.discovered', 'WAIT_FOR_IP', 'Awaiting LAN operational advertisement');
        try {
          const discovered = await this.handover.waitForIp(ctx.commissioningId, {
            protocol: 'improv',
            expectedName: found.adv.name,
            timeoutMs: 200,
          });
          if (discovered?.address) targetIp = discovered.address;
        } catch {
          // Handover discovery timeout is non-fatal for Improv when provisioned state is confirmed
        }
      }

      return {
        status: 'completed',
        detail: {
          identifier: found.adv.identifier,
          transport: 'ble',
          state: currentState,
          handoverDisconnected: disconnected,
          ...(redirectUrl ? { redirectUrl } : {}),
          ...(targetIp ? { ip: targetIp } : {}),
        },
      };
    } finally {
      this.radios.closeScansForSession(ctx.commissioningId);
      this.radios.revokeLease(lease.leaseToken);
      await connection.close().catch(() => undefined);
    }
  }

  private async resolveCandidate(
    ctx: CommissioningContext,
    hint: string | undefined,
  ): Promise<{ agent: RadioAgent; adv: Advertisement } | undefined> {
    if (ctx.candidate && ctx.candidate.transport === 'ble') {
      const agent = this.radios.claimTransportOwner(ctx.commissioningId, ctx.candidate.agentId);
      return { agent, adv: ctx.candidate };
    }
    return this.scan(ctx, hint);
  }

  private async scan(
    ctx: CommissioningContext,
    hint: string | undefined,
  ): Promise<{ agent: RadioAgent; adv: Advertisement } | undefined> {
    ctx.emit('discovery.radio.started', 'RADIO_DISCOVERY', 'Scanning for Improv BLE devices');
    const stream = this.radios.scanAcrossAgents({
      commissioningId: ctx.commissioningId,
      homeId: ctx.homeId ?? 'home-default',
      request: {
        commissioningId: ctx.commissioningId,
        kind: 'improv',
        timeoutMs: this.scanMs,
        serviceUuids: [IMPROV_SERVICE_UUID],
      },
      signal: ctx.abortSignal,
    });

    for await (const adv of stream) {
      if (!hint || adv.name.toLowerCase().includes(hint)) {
        const agent = this.radios.claimTransportOwner(ctx.commissioningId, adv.agentId);
        return { agent, adv };
      }
    }
    return undefined;
  }
}

export class ImprovSerialAdapter implements CommissioningAdapter {
  public readonly name = 'improv-serial';

  constructor(
    private readonly connector?: SerialPortConnector,
    private readonly handover?: IpHandoverCoordinator,
    private readonly timeoutMs = 30_000,
  ) {}

  canHandle(code: ParsedSetupCode): boolean {
    return code.protocol === 'improv' && code.improv?.transport === 'serial';
  }

  async commission(ctx: CommissioningContext): Promise<CommissioningResult> {
    if (!ctx.wifiCredentials) {
      return {
        status: 'credentials_required',
        requiresCredentials: {
          kind: 'wifi',
          reason: 'Improv serial device needs Wi-Fi credentials.',
        },
      };
    }

    if (!this.connector) {
      return { status: 'failed', error: 'no_serial_connector_available' };
    }

    const portPath =
      ctx.parsedCode.improv?.serialPort ??
      ctx.candidate?.address ??
      ctx.candidate?.identifier ??
      '/dev/ttyUSB0';

    ctx.emit('secure_session.started', 'SECURE_CHANNEL', `Opening serial port ${portPath}`);
    const connection = await this.connector.connect(portPath);

    try {
      const parser = new ImprovSerialFrameParser();
      let redirectUrl: string | undefined;
      let failureReason: string | undefined;

      const outcome = await new Promise<'ok' | 'error'>((resolve) => {
        const timer = setTimeout(() => {
          if (!failureReason) failureReason = 'serial_provisioning_timeout';
          resolve('error');
        }, this.timeoutMs);

        const onDone = (res: 'ok' | 'error') => {
          clearTimeout(timer);
          resolve(res);
        };

        const unsubscribe = connection.onData(async (chunk) => {
          const packets = parser.append(chunk);
          for (const packet of packets) {
            if (packet.type === ImprovSerialType.errorState) {
              const err = packet.data[0] ?? 0;
              if (err === ImprovError.noError) continue;
              if (err === ImprovError.unableToConnect) {
                failureReason = 'invalid_network_credentials';
              } else if (err === ImprovError.notAuthorized) {
                failureReason = 'not_authorized';
              } else if (err === ImprovError.invalidRpc) {
                failureReason = 'invalid_rpc_packet';
              } else if (err === ImprovError.unknownCommand) {
                failureReason = 'unknown_rpc_command';
              } else {
                failureReason = 'improv_provisioning_failed';
              }
              unsubscribe();
              onDone('error');
              return;
            }

            if (packet.type === ImprovSerialType.rpcResult) {
              const res = decodeImprovRpcResult(packet.data);
              if (res && res.command === ImprovCommand.wifiSettings && res.strings[0]) {
                redirectUrl = res.strings[0];
              }
            }

            if (packet.type === ImprovSerialType.currentState) {
              const state = packet.data[0] ?? 0;
              if (state === ImprovState.authorizationRequired) {
                ctx.emit(
                  'improv.authorization_required',
                  'SECURE_CHANNEL',
                  'Serial device requires authorization button press',
                );
              } else if (state === ImprovState.authorized) {
                ctx.emit(
                  'improv.authorized',
                  'SECURE_CHANNEL',
                  'Serial device ready for credentials',
                );
                ctx.emit(
                  'network.provisioning',
                  'NETWORK_PROVISION',
                  'Writing credentials to serial port',
                );
                const wifiCmd = encodeImprovWifiCommand(
                  ctx.wifiCredentials!.ssid,
                  ctx.wifiCredentials!.password,
                );
                const frame = encodeImprovSerialPacket(ImprovSerialType.rpcCommand, wifiCmd);
                await connection.write(frame);
              } else if (state === ImprovState.provisioning) {
                ctx.emit(
                  'network.provisioning',
                  'NETWORK_PROVISION',
                  'Serial device connecting to Wi-Fi',
                );
              } else if (state === ImprovState.provisioned) {
                ctx.emit('network.provisioned', 'WAIT_FOR_IP', 'Serial device connected to Wi-Fi');
                unsubscribe();
                onDone('ok');
                return;
              }
            }
          }
        });
      });

      if (outcome !== 'ok') {
        return { status: 'failed', error: failureReason ?? 'improv_serial_failed' };
      }

      let targetIp = parseHostFromRedirectUrl(redirectUrl);
      if (!targetIp && this.handover) {
        ctx.emit('device.ip.discovered', 'WAIT_FOR_IP', 'Awaiting LAN operational advertisement');
        try {
          const discovered = await this.handover.waitForIp(ctx.commissioningId, {
            protocol: 'improv',
            expectedName: ctx.parsedCode.improv?.deviceNameHint,
            timeoutMs: 200,
          });
          if (discovered?.address) targetIp = discovered.address;
        } catch {
          // Non-fatal
        }
      }

      return {
        status: 'completed',
        detail: {
          port: portPath,
          transport: 'serial',
          ...(redirectUrl ? { redirectUrl } : {}),
          ...(targetIp ? { ip: targetIp } : {}),
        },
      };
    } finally {
      await connection.close().catch(() => undefined);
    }
  }
}
