/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DiscoveryRegistry,
  IMPROV_CHARACTERISTICS,
  ImprovError,
  ImprovSerialType,
  ImprovState,
  encodeImprovSerialPacket,
  improvChecksum,
  type Advertisement,
  type CommissioningContext,
  type CommissioningEvent,
  type RadioAgent,
  type RadioConnection,
} from '@haus/core';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import {
  ImprovBleAdapter,
  ImprovSerialAdapter,
  type SerialPortConnection,
  type SerialPortConnector,
} from '../../src/commissioning/improv.js';
import { RadioAgentRegistry } from '../../src/commissioning/radio.js';
import { IpHandoverCoordinator } from '../../src/commissioning/handover.js';

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  tempDirs = [];
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'haus-improv-test-'));
  tempDirs.push(dir);
  return dir;
}

function createMockBleDevice(options: {
  identifier: string;
  name: string;
  errorCode?: number;
  redirectUrl?: string;
  requireAuth?: boolean;
}): { agent: RadioAgent; writes: Uint8Array[] } {
  const writes: Uint8Array[] = [];
  const adv: Advertisement = {
    agentId: 'agent-hub-ble',
    transport: 'ble',
    protocol: 'improv',
    identifier: options.identifier,
    name: options.name,
  };

  const agent: RadioAgent = {
    id: 'agent-hub-ble',
    platform: 'hub',
    async *scan() {
      yield adv;
    },
    async connect(): Promise<RadioConnection> {
      let stateCb: ((d: Uint8Array) => void) | undefined;
      let errorCb: ((d: Uint8Array) => void) | undefined;
      let rpcCb: ((d: Uint8Array) => void) | undefined;

      return {
        device: { agentId: 'agent-hub-ble', identifier: options.identifier, transport: 'ble' },
        async readCharacteristic(_s, c) {
          if (c === IMPROV_CHARACTERISTICS.currentState) {
            return new Uint8Array([
              options.requireAuth ? ImprovState.authorizationRequired : ImprovState.authorized,
            ]);
          }
          return new Uint8Array();
        },
        async writeCharacteristic(_s, c, data) {
          writes.push(data);
          if (c === IMPROV_CHARACTERISTICS.rpcCommand) {
            if (options.errorCode !== undefined) {
              errorCb?.(new Uint8Array([options.errorCode]));
              return;
            }
            if (options.redirectUrl) {
              const urlBytes = new TextEncoder().encode(options.redirectUrl);
              const body = new Uint8Array([1, urlBytes.length + 1, urlBytes.length, ...urlBytes]);
              rpcCb?.(new Uint8Array([...body, improvChecksum(body)]));
            }
            stateCb?.(new Uint8Array([ImprovState.provisioned]));
          }
        },
        async subscribeCharacteristic(_s, c, l) {
          if (c === IMPROV_CHARACTERISTICS.currentState) {
            stateCb = l;
            if (options.requireAuth) {
              // Simulate physical button press on device after 15ms
              setTimeout(() => l(new Uint8Array([ImprovState.authorized])), 15);
            }
          } else if (c === IMPROV_CHARACTERISTICS.errorState) {
            errorCb = l;
          } else if (c === IMPROV_CHARACTERISTICS.rpcResult) {
            rpcCb = l;
          }
          return () => undefined;
        },
        async close() {},
      };
    },
  };

  return { agent, writes };
}

describe('Improv Commissioning Standalone Suite', () => {
  it('provisions Improv BLE device with chunks, redirect URL and handover disconnect', async () => {
    const radios = new RadioAgentRegistry();
    const { agent, writes } = createMockBleDevice({
      identifier: 'AA:11:22:33:44:55',
      name: 'ESPHome-Plug',
      redirectUrl: 'http://192.168.4.155/',
    });
    radios.register(agent);

    const adapter = new ImprovBleAdapter(radios, 500);
    const ctx: CommissioningContext = {
      commissioningId: 'comm-improv-1',
      homeId: 'home-default',
      parsedCode: {
        kind: 'improv',
        raw: 'improv:ESPHome-Plug',
        protocol: 'improv',
        improv: { raw: 'improv:ESPHome-Plug', deviceNameHint: 'ESPHome-Plug' },
      },
      wifiCredentials: { ssid: 'HausWifi', password: 'securePassword987' },
      emit: () => undefined,
    };

    const res = await adapter.commission(ctx);
    expect(res.status).toBe('completed');
    expect(res.detail?.identifier).toBe('AA:11:22:33:44:55');
    expect(res.detail?.redirectUrl).toBe('http://192.168.4.155/');
    expect(res.detail?.ip).toBe('192.168.4.155');
    expect(res.detail?.handoverDisconnected).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((w) => w.length <= 20)).toBe(true);
  });

  it('handles physical authorization requirement and state transitions', async () => {
    const radios = new RadioAgentRegistry();
    const { agent } = createMockBleDevice({
      identifier: 'BB:22:33:44:55:66',
      name: 'ESPHome-Button',
      requireAuth: true,
      redirectUrl: 'http://192.168.4.156/',
    });
    radios.register(agent);

    const emittedEvents: string[] = [];
    const adapter = new ImprovBleAdapter(radios, 500);
    const ctx: CommissioningContext = {
      commissioningId: 'comm-improv-2',
      homeId: 'home-default',
      parsedCode: {
        kind: 'improv',
        raw: 'improv:ESPHome-Button',
        protocol: 'improv',
        improv: { raw: 'improv:ESPHome-Button', deviceNameHint: 'ESPHome-Button' },
      },
      wifiCredentials: { ssid: 'HausWifi', password: 'securePassword987' },
      emit: (evt, state, msg) => {
        emittedEvents.push(`${evt}:${state}:${msg}`);
      },
    };

    const res = await adapter.commission(ctx);
    expect(res.status).toBe('completed');
    expect(emittedEvents.some((e) => e.startsWith('improv.authorization_required:SECURE_CHANNEL'))).toBe(true);
    expect(emittedEvents.some((e) => e.startsWith('improv.authorized:SECURE_CHANNEL'))).toBe(true);
    expect(emittedEvents.some((e) => e.startsWith('network.provisioned:WAIT_FOR_IP'))).toBe(true);
  });

  it('maps wrong Wi-Fi password error without corrupting controller state', async () => {
    const radios = new RadioAgentRegistry();
    const { agent } = createMockBleDevice({
      identifier: 'CC:33:44:55:66:77',
      name: 'ESPHome-Bulb',
      errorCode: ImprovError.unableToConnect,
    });
    radios.register(agent);

    const adapter = new ImprovBleAdapter(radios, 500);
    const ctx: CommissioningContext = {
      commissioningId: 'comm-improv-3',
      homeId: 'home-default',
      parsedCode: {
        kind: 'improv',
        raw: 'improv:ESPHome-Bulb',
        protocol: 'improv',
        improv: { raw: 'improv:ESPHome-Bulb', deviceNameHint: 'ESPHome-Bulb' },
      },
      wifiCredentials: { ssid: 'HausWifi', password: 'wrongPassword!' },
      emit: () => undefined,
    };

    const res = await adapter.commission(ctx);
    expect(res.status).toBe('failed');
    expect(res.error).toBe('invalid_network_credentials');
  });

  it('provisions device over serial port with Improv framing and IP discovery', async () => {
    let dataListener: ((chunk: Uint8Array) => void) | undefined;
    const writtenChunks: Uint8Array[] = [];

    const mockConnector: SerialPortConnector = {
      async connect(portPath: string): Promise<SerialPortConnection> {
        return {
          portPath,
          async write(data) {
            writtenChunks.push(data);
            setTimeout(() => {
              const url = new TextEncoder().encode('http://192.168.4.199/');
              const rpcBody = new Uint8Array([1, url.length + 1, url.length, ...url]);
              const rpcPacket = new Uint8Array([...rpcBody, improvChecksum(rpcBody)]);
              const resFrame = encodeImprovSerialPacket(ImprovSerialType.rpcResult, rpcPacket);
              const provFrame = encodeImprovSerialPacket(
                ImprovSerialType.currentState,
                new Uint8Array([ImprovState.provisioned]),
              );
              dataListener?.(new Uint8Array([...resFrame, ...provFrame]));
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

    const discovery = new DiscoveryRegistry();
    const handover = new IpHandoverCoordinator(discovery);
    const adapter = new ImprovSerialAdapter(mockConnector, handover, 1000);

    const ctx: CommissioningContext = {
      commissioningId: 'comm-improv-serial-1',
      homeId: 'home-default',
      parsedCode: {
        kind: 'improv',
        raw: 'improv:serial:/dev/ttyUSB0',
        protocol: 'improv',
        improv: { raw: 'improv:serial:/dev/ttyUSB0', transport: 'serial', serialPort: '/dev/ttyUSB0' },
      },
      wifiCredentials: { ssid: 'HausWifi', password: 'securePassword987' },
      emit: () => undefined,
    };

    const res = await adapter.commission(ctx);
    expect(res.status).toBe('completed');
    expect(res.detail?.port).toBe('/dev/ttyUSB0');
    expect(res.detail?.transport).toBe('serial');
    expect(res.detail?.redirectUrl).toBe('http://192.168.4.199/');
    expect(res.detail?.ip).toBe('192.168.4.199');
    expect(writtenChunks.length).toBeGreaterThan(0);
  });

  it('executes full Improv onboarding lifecycle via Hub Nest REST API', async () => {
    const dir = await createTempDir();
    const app = await createNestApp({ dataDirectory: dir, port: 0 });
    await app.listen(0);

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);
    const commService = app.get<CommissioningService>(CommissioningService);

    const { agent } = createMockBleDevice({
      identifier: 'EE:55:66:77:88:99',
      name: 'ESPHome-Dimmer',
      redirectUrl: 'http://192.168.4.200/',
    });
    commService.radios.register(agent);

    try {
      const challengeRes = await fetch(`${base}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const challenge = (await challengeRes.json()) as { sessionId: string };
      const challengeCode = authService.pairing.getSession(challenge.sessionId)!.challengeCode;

      const confirmRes = await fetch(`${base}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          challengeCode,
          client: { clientId: 'admin-client', clientName: 'Admin Phone', role: 'admin' },
        }),
      });
      const confirmed = (await confirmRes.json()) as { grant: { homeId: string } };

      const pairRes = await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const token = paired.credentials.sessionToken;
      const headers = {
        authorization: `Bearer ${token}`,
        'x-haus-home-id': confirmed.grant.homeId,
        'content-type': 'application/json',
      };

      // 1. Initiate commissioning session with Improv code
      const sessionRes = await fetch(`${base}/api/commissioning/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: 'improv:ESPHome-Dimmer' }),
      });
      expect(sessionRes.status).toBe(202);
      const session = (await sessionRes.json()) as {
        commissioningId: string;
        state: string;
        parsedCode: { protocol: string };
      };
      expect(session.parsedCode.protocol).toBe('improv');

      // 2. Poll session - transitions to OBTAIN_NETWORK_CREDENTIALS
      let currentTx: { state: string; requiresCredentials?: { kind: string } } | undefined;
      for (let i = 0; i < 20; i++) {
        const checkRes = await fetch(`${base}/api/commissioning/sessions/${session.commissioningId}`, {
          headers,
        });
        currentTx = (await checkRes.json()) as {
          state: string;
          requiresCredentials?: { kind: string };
        };
        if (currentTx.state === 'OBTAIN_NETWORK_CREDENTIALS') break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(currentTx?.state).toBe('OBTAIN_NETWORK_CREDENTIALS');
      expect(currentTx?.requiresCredentials?.kind).toBe('wifi');

      // 3. Provide Wi-Fi credentials
      const credRes = await fetch(
        `${base}/api/commissioning/sessions/${session.commissioningId}/credentials`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ ssid: 'HausMain', password: 'validPassword123' }),
        },
      );
      expect(credRes.status).toBe(202);

      // 4. Poll until DONE state
      let finalTx: { state: string; events: CommissioningEvent[] } | undefined;
      for (let i = 0; i < 30; i++) {
        const checkRes = await fetch(`${base}/api/commissioning/sessions/${session.commissioningId}`, {
          headers,
        });
        finalTx = (await checkRes.json()) as { state: string; events: CommissioningEvent[] };
        if (finalTx.state === 'DONE') break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(finalTx?.state).toBe('DONE');

      const eventTypes = finalTx?.events.map((e) => e.type) ?? [];
      expect(eventTypes).toContain('secure_session.started');
      expect(eventTypes).toContain('network.provisioning');
      expect(eventTypes).toContain('network.provisioned');
    } finally {
      await app.close();
    }
  });
});
