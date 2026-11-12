/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  DiscoveryRegistry,
  IMPROV_CHARACTERISTICS,
  ImprovError,
  ImprovSerialType,
  ImprovState,
  encodeImprovSerialPacket,
  improvChecksum,
  parseSetupCode,
  type Advertisement,
  type CommissioningContext,
  type RadioAgent,
  type RadioConnection,
} from '@haus/core';
import { IpHandoverCoordinator } from '../../src/commissioning/handover.js';
import {
  ImprovBleAdapter,
  ImprovSerialAdapter,
  type SerialPortConnection,
  type SerialPortConnector,
} from '../../src/commissioning/improv.js';
import { RadioAgentRegistry } from '../../src/commissioning/radio.js';

function createMockBleAgent(options: {
  initialState?: number;
  triggerStateAfterAuth?: number;
  errorCode?: number;
  redirectUrl?: string;
  writes?: Uint8Array[];
}): RadioAgent {
  const writes = options.writes ?? [];
  const adv: Advertisement = {
    agentId: 'agent-1',
    transport: 'ble',
    protocol: 'improv',
    identifier: 'AA:BB:CC:DD:EE:FF',
    name: 'Smart-Switch',
  };

  return {
    id: 'agent-1',
    platform: 'hub',
    async *scan() {
      yield adv;
    },
    async connect(): Promise<RadioConnection> {
      let stateListener: ((d: Uint8Array) => void) | undefined;
      let errorListener: ((d: Uint8Array) => void) | undefined;
      let rpcListener: ((d: Uint8Array) => void) | undefined;

      return {
        device: { agentId: 'agent-1', identifier: 'AA:BB:CC:DD:EE:FF', transport: 'ble' },
        async readCharacteristic(_s, c) {
          if (c === IMPROV_CHARACTERISTICS.currentState) {
            return new Uint8Array([options.initialState ?? ImprovState.authorized]);
          }
          return new Uint8Array();
        },
        async writeCharacteristic(_s, c, data) {
          writes.push(data);
          if (c === IMPROV_CHARACTERISTICS.rpcCommand) {
            if (options.errorCode !== undefined) {
              errorListener?.(new Uint8Array([options.errorCode]));
              return;
            }
            if (options.redirectUrl) {
              const urlBytes = new TextEncoder().encode(options.redirectUrl);
              const body = new Uint8Array([1, urlBytes.length + 1, urlBytes.length, ...urlBytes]);
              const resPacket = new Uint8Array([...body, improvChecksum(body)]);
              rpcListener?.(resPacket);
            }
            stateListener?.(
              new Uint8Array([options.triggerStateAfterAuth ?? ImprovState.provisioned]),
            );
          }
        },
        async subscribeCharacteristic(_s, c, l) {
          if (c === IMPROV_CHARACTERISTICS.currentState) {
            stateListener = l;
          } else if (c === IMPROV_CHARACTERISTICS.errorState) {
            errorListener = l;
            if (options.errorCode !== undefined && options.initialState === undefined) {
              setTimeout(() => errorListener?.(new Uint8Array([options.errorCode!])), 10);
            }
          } else if (c === IMPROV_CHARACTERISTICS.rpcResult) {
            rpcListener = l;
          }
          return () => undefined;
        },
        async close() {},
      };
    },
  };
}

function createContext(code: string, wifi = true): CommissioningContext & { emitted: string[] } {
  const emitted: string[] = [];
  return {
    commissioningId: 'comm-improv-test',
    homeId: 'home-default',
    parsedCode: parseSetupCode(code),
    wifiCredentials: wifi ? { ssid: 'HausNetwork', password: 'secretPassword123' } : undefined,
    emitted,
    emit: (event, state, msg) => {
      emitted.push(`${event}:${state}:${msg}`);
    },
  };
}

describe('ImprovBleAdapter', () => {
  it('fails when no radio agents are registered', async () => {
    const radios = new RadioAgentRegistry();
    const adapter = new ImprovBleAdapter(radios, 500);
    const ctx = createContext('improv:Smart-Switch', true);
    const res = await adapter.commission(ctx);
    expect(res.status).toBe('failed');
    expect(res.error).toBe('no_radio_agent_available');
  });

  it('requests Wi-Fi credentials if not supplied', async () => {
    const radios = new RadioAgentRegistry();
    radios.register(createMockBleAgent({}));
    const adapter = new ImprovBleAdapter(radios, 500);
    const ctx = createContext('improv:Smart-Switch', false);
    const res = await adapter.commission(ctx);
    expect(res.status).toBe('credentials_required');
    expect(res.requiresCredentials?.kind).toBe('wifi');
  });

  it('provisions over BLE with chunks, redirect URL and handover disconnect', async () => {
    const radios = new RadioAgentRegistry();
    const writes: Uint8Array[] = [];
    radios.register(
      createMockBleAgent({
        redirectUrl: 'http://192.168.4.150/',
        writes,
      }),
    );
    const adapter = new ImprovBleAdapter(radios, 500);
    const ctx = createContext('improv:Smart-Switch', true);
    const res = await adapter.commission(ctx);

    expect(res.status).toBe('completed');
    expect(res.detail?.identifier).toBe('AA:BB:CC:DD:EE:FF');
    expect(res.detail?.redirectUrl).toBe('http://192.168.4.150/');
    expect(res.detail?.ip).toBe('192.168.4.150');
    expect(res.detail?.handoverDisconnected).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((w) => w.length <= 20)).toBe(true);
  });

  it('handles physical authorization requirement before credentials transmission', async () => {
    const radios = new RadioAgentRegistry();
    let stateCb: ((d: Uint8Array) => void) | undefined;
    const agent: RadioAgent = {
      id: 'agent-auth',
      platform: 'hub',
      async *scan() {
        yield { agentId: 'agent-auth', transport: 'ble', protocol: 'improv', identifier: '11:22', name: 'Lamp' };
      },
      async connect(): Promise<RadioConnection> {
        return {
          device: { agentId: 'agent-auth', identifier: '11:22', transport: 'ble' },
          async readCharacteristic() {
            return new Uint8Array([ImprovState.authorizationRequired]);
          },
          async writeCharacteristic(_s, _c, _d) {
            stateCb?.(new Uint8Array([ImprovState.provisioned]));
          },
          async subscribeCharacteristic(_s, c, l) {
            if (c === IMPROV_CHARACTERISTICS.currentState) {
              stateCb = l;
              // Simulate user pressing physical button after 20ms
              setTimeout(() => {
                l(new Uint8Array([ImprovState.authorized]));
              }, 20);
            }
            return () => undefined;
          },
          async close() {},
        };
      },
    };
    radios.register(agent);
    const adapter = new ImprovBleAdapter(radios, 500);
    const ctx = createContext('improv:Lamp', true);
    const res = await adapter.commission(ctx);

    expect(res.status).toBe('completed');
    expect(ctx.emitted.some((e) => e.startsWith('improv.authorization_required:SECURE_CHANNEL'))).toBe(true);
    expect(ctx.emitted.some((e) => e.startsWith('improv.authorized:SECURE_CHANNEL'))).toBe(true);
  });

  it('maps invalid network credentials error when device fails to connect', async () => {
    const radios = new RadioAgentRegistry();
    radios.register(createMockBleAgent({ errorCode: ImprovError.unableToConnect }));
    const adapter = new ImprovBleAdapter(radios, 500);
    const ctx = createContext('improv:Smart-Switch', true);
    const res = await adapter.commission(ctx);

    expect(res.status).toBe('failed');
    expect(res.error).toBe('invalid_network_credentials');
  });

  it('maps not authorized error when user denies authorization', async () => {
    const radios = new RadioAgentRegistry();
    radios.register(createMockBleAgent({ errorCode: ImprovError.notAuthorized }));
    const adapter = new ImprovBleAdapter(radios, 500);
    const ctx = createContext('improv:Smart-Switch', true);
    const res = await adapter.commission(ctx);

    expect(res.status).toBe('failed');
    expect(res.error).toBe('not_authorized');
  });
});

describe('ImprovSerialAdapter', () => {
  it('handles serial setup code and rejects missing credentials', async () => {
    const adapter = new ImprovSerialAdapter();
    expect(adapter.canHandle(parseSetupCode('improv:serial:/dev/ttyUSB0'))).toBe(true);
    expect(adapter.canHandle(parseSetupCode('improv:ble:ESP32'))).toBe(false);

    const ctx = createContext('improv:serial:/dev/ttyUSB0', false);
    const res = await adapter.commission(ctx);
    expect(res.status).toBe('credentials_required');
  });

  it('provisions device over serial port with Improv framing and IP redirect', async () => {
    const writtenFrames: Uint8Array[] = [];
    let dataListener: ((chunk: Uint8Array) => void) | undefined;

    const mockConnector: SerialPortConnector = {
      async connect(portPath: string): Promise<SerialPortConnection> {
        return {
          portPath,
          async write(data: Uint8Array) {
            writtenFrames.push(data);
            // Simulate device acknowledging: send RPC result with redirect URL and provisioned state
            setTimeout(() => {
              const url = new TextEncoder().encode('http://192.168.4.188/');
              const rpcBody = new Uint8Array([1, url.length + 1, url.length, ...url]);
              const rpcPacket = new Uint8Array([...rpcBody, improvChecksum(rpcBody)]);
              const resultFrame = encodeImprovSerialPacket(ImprovSerialType.rpcResult, rpcPacket);

              const provFrame = encodeImprovSerialPacket(
                ImprovSerialType.currentState,
                new Uint8Array([ImprovState.provisioned]),
              );

              dataListener?.(new Uint8Array([...resultFrame, ...provFrame]));
            }, 10);
          },
          onData(l) {
            dataListener = l;
            // Initially report device ready (authorized)
            setTimeout(() => {
              const authFrame = encodeImprovSerialPacket(
                ImprovSerialType.currentState,
                new Uint8Array([ImprovState.authorized]),
              );
              l(authFrame);
            }, 5);
            return () => undefined;
          },
          async close() {},
        };
      },
    };

    const discovery = new DiscoveryRegistry();
    const handover = new IpHandoverCoordinator(discovery);
    const adapter = new ImprovSerialAdapter(mockConnector, handover, 1000);
    const ctx = createContext('improv:serial:/dev/ttyUSB0', true);
    const res = await adapter.commission(ctx);

    expect(res.status).toBe('completed');
    expect(res.detail?.port).toBe('/dev/ttyUSB0');
    expect(res.detail?.transport).toBe('serial');
    expect(res.detail?.redirectUrl).toBe('http://192.168.4.188/');
    expect(res.detail?.ip).toBe('192.168.4.188');
    expect(writtenFrames.length).toBeGreaterThan(0);
  });

  it('handles serial error state when credentials fail', async () => {
    const mockConnector: SerialPortConnector = {
      async connect(portPath: string): Promise<SerialPortConnection> {
        return {
          portPath,
          async write(_d) {
            // Simulate error response: unable to connect (0x03)
            setTimeout(() => {
              const errFrame = encodeImprovSerialPacket(
                ImprovSerialType.errorState,
                new Uint8Array([ImprovError.unableToConnect]),
              );
              dataListener?.(errFrame);
            }, 10);
          },
          onData(l) {
            dataListener = l;
            setTimeout(() => {
              l(encodeImprovSerialPacket(ImprovSerialType.currentState, new Uint8Array([ImprovState.authorized])));
            }, 5);
            return () => undefined;
          },
          async close() {},
        };
      },
    };
    let dataListener: ((chunk: Uint8Array) => void) | undefined;

    const adapter = new ImprovSerialAdapter(mockConnector, undefined, 1000);
    const ctx = createContext('improv:serial:/dev/ttyUSB0', true);
    const res = await adapter.commission(ctx);

    expect(res.status).toBe('failed');
    expect(res.error).toBe('invalid_network_credentials');
  });
});
