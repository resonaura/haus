/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HAP_PAIRING_SERVICE_UUID,
  HAP_PAIR_SETUP_CHAR_UUID,
  HAP_PAIR_VERIFY_CHAR_UUID,
  parseSetupCode,
  type Advertisement,
  type CommissioningContext,
  type CommissioningEvent,
  type RadioAgent,
} from '@haus/core';
import {
  fastSrp,
  hapCrypto,
  hapTlv,
  HapTlvTag,
  type FastSrpServer,
  type HapBlePeripheral,
} from '@haus/homekit';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import { HomeKitControllerService } from '../../src/homekit/service.js';
import { HomeKitIpAdapter } from '../../src/commissioning/adapters.js';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../../src/home/home.service.js';

interface TestBleCandidate extends Advertisement {
  peripheral?: HapBlePeripheral;
  details?: Record<string, unknown>;
}

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  tempDirs = [];
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'haus-homekit-test-'));
  tempDirs.push(dir);
  return dir;
}

function createMockHapBlePeripheral(options: {
  id: string;
  pin: string;
  accessoryId: string;
  alreadyPaired?: boolean;
  serviceUuids?: string[];
}): HapBlePeripheral {
  const accKeys = hapCrypto.generateEd25519KeyPair();
  const accLtpk = Buffer.from(accKeys.publicKey);
  const accLtsk = Buffer.from(accKeys.secretKey);

  let srpServer: FastSrpServer | undefined;
  let sessionKey: Buffer;
  let sharedSecret: Buffer;

  const gattStorage = new Map<string, Uint8Array>();

  return {
    id: options.id,
    name: 'Eve Door Sensor BLE',
    serviceUuids: options.serviceUuids ?? [HAP_PAIRING_SERVICE_UUID],
    readCharacteristic: async (uuid: string) => {
      if (options.alreadyPaired && uuid === HAP_PAIR_SETUP_CHAR_UUID) {
        return Uint8Array.from(hapTlv.encode(HapTlvTag.Error, 2));
      }
      return gattStorage.get(uuid) ?? new Uint8Array(0);
    },
    writeCharacteristic: async (uuid: string, data: Uint8Array | number[]) => {
      const buf = Buffer.from(data);
      const tlv = hapTlv.decode(buf);

      if (uuid === HAP_PAIR_SETUP_CHAR_UUID) {
        const state = tlv[HapTlvTag.State]?.[0];
        if (state === 1) {
          if (options.alreadyPaired) {
            gattStorage.set(HAP_PAIR_SETUP_CHAR_UUID, Uint8Array.from(hapTlv.encode(HapTlvTag.State, 2, HapTlvTag.Error, 2)));
            return;
          }
          const salt = Buffer.from('1234567890abcdef1234567890abcdef', 'hex');
          const secret2 = await fastSrp.SRP.genKey(32);
          srpServer = new fastSrp.SrpServer(fastSrp.SRP.params.hap, salt, Buffer.from('Pair-Setup'), Buffer.from(options.pin.trim()), secret2);
          const B = srpServer.computeB();
          gattStorage.set(HAP_PAIR_SETUP_CHAR_UUID, Uint8Array.from(hapTlv.encode(HapTlvTag.State, 2, HapTlvTag.PublicKey, B, HapTlvTag.Salt, salt)));
        } else if (state === 3) {
          if (!srpServer) throw new Error('srp_server_not_initialized');
          srpServer.setA(tlv[HapTlvTag.PublicKey]);
          srpServer.checkM1(tlv[HapTlvTag.Proof]);
          const M2_proof = srpServer.computeM2();
          sessionKey = hapCrypto.HKDF('sha512', Buffer.from('Pair-Setup-Encrypt-Salt'), srpServer.computeK(), Buffer.from('Pair-Setup-Encrypt-Info'), 32);
          gattStorage.set(HAP_PAIR_SETUP_CHAR_UUID, Uint8Array.from(hapTlv.encode(HapTlvTag.State, 4, HapTlvTag.Proof, M2_proof)));
        } else if (state === 5) {
          if (!srpServer) throw new Error('srp_server_not_initialized');
          const signInfo = hapCrypto.HKDF('sha512', Buffer.from('Pair-Setup-Accessory-Sign-Salt'), srpServer.computeK(), Buffer.from('Pair-Setup-Accessory-Sign-Info'), 32);
          const accSig = hapCrypto.ed25519Sign(Buffer.concat([signInfo, Buffer.from(options.accessoryId), accLtpk]), accLtsk);
          const subTlv = hapTlv.encode(HapTlvTag.Identifier, Buffer.from(options.accessoryId), HapTlvTag.PublicKey, accLtpk, HapTlvTag.Signature, accSig);
          const enc = hapCrypto.chacha20_poly1305_encryptAndSeal(sessionKey, Buffer.from('PS-Msg06', 'utf8'), null, subTlv);
          gattStorage.set(HAP_PAIR_SETUP_CHAR_UUID, Uint8Array.from(hapTlv.encode(HapTlvTag.State, 6, HapTlvTag.EncryptedData, Buffer.concat([enc.ciphertext, enc.authTag]))));
        }
      } else if (uuid === HAP_PAIR_VERIFY_CHAR_UUID) {
        const state = tlv[HapTlvTag.State]?.[0];
        if (state === 1) {
          const accEphemeral = hapCrypto.generateCurve25519KeyPair();
          const serverEphemeralPub = Buffer.from(accEphemeral.publicKey);
          const clientEphemeralPub = tlv[HapTlvTag.PublicKey];
          sharedSecret = Buffer.from(hapCrypto.generateCurve25519SharedSecKey(accEphemeral.secretKey, clientEphemeralPub));
          const pvSessionKey = hapCrypto.HKDF('sha512', Buffer.from('Pair-Verify-Encrypt-Salt'), sharedSecret, Buffer.from('Pair-Verify-Encrypt-Info'), 32);
          const sig = hapCrypto.ed25519Sign(Buffer.concat([serverEphemeralPub, Buffer.from(options.accessoryId), clientEphemeralPub]), accLtsk);
          const sub = hapTlv.encode(HapTlvTag.Identifier, Buffer.from(options.accessoryId), HapTlvTag.Signature, sig);
          const enc = hapCrypto.chacha20_poly1305_encryptAndSeal(pvSessionKey, Buffer.from('PV-Msg02', 'utf8'), null, sub);
          gattStorage.set(HAP_PAIR_VERIFY_CHAR_UUID, Uint8Array.from(hapTlv.encode(HapTlvTag.State, 2, HapTlvTag.PublicKey, serverEphemeralPub, HapTlvTag.EncryptedData, Buffer.concat([enc.ciphertext, enc.authTag]))));
        } else if (state === 3) {
          gattStorage.set(HAP_PAIR_VERIFY_CHAR_UUID, Uint8Array.from(hapTlv.encode(HapTlvTag.State, 4)));
        }
      }
    },
  };
}

describe('HomeKit IP/BLE & Honest Provisioning (P20.7)', () => {
  it('pairs true HAP-BLE accessory honestly over Bluetooth LE without Wi-Fi credentials', async () => {
    const dataDir = await createTempDir();
    const app = await createNestApp({ dataDirectory: dataDir, port: 0 });
    await app.listen(0);

    const hkService = app.get(HomeKitControllerService);
    const homeService = app.get<StandaloneHomeService>(STANDALONE_HOME_SERVICE);
    const pin = '031-45-154';
    const accessoryId = 'AA:BB:CC:DD:EE:01';

    const mockPeripheral = createMockHapBlePeripheral({
      id: 'ble-door-sensor',
      pin,
      accessoryId,
    });

    const adapter = new HomeKitIpAdapter(hkService);
    const events: CommissioningEvent[] = [];
    const candidate: TestBleCandidate = {
      agentId: 'hub-ble',
      transport: 'ble',
      protocol: 'homekit',
      identifier: accessoryId,
      name: 'Eve Door & Window',
      paired: false,
      peripheral: mockPeripheral,
    };
    const ctx: CommissioningContext = {
      commissioningId: 'comm-hk-ble-1',
      homeId: 'home-homekit',
      parsedCode: parseSetupCode(pin),
      candidate,
      emit: (type, state, message, detail) => {
        events.push({ seq: events.length + 1, timestamp: Date.now(), type, state, message, detail });
      },
    };

    const result = await adapter.commission(ctx);
    if (result.status !== 'completed') console.error('TEST 1 FAILURE ERROR:', result.error);
    expect(result.status).toBe('completed');
    expect(result.requiresCredentials).toBeUndefined();

    // Verify events: classified as hap-ble, pairing without Wi-Fi credentials
    const classified = events.find((e) => e.type === 'homekit.classified');
    expect(classified?.detail?.classification).toBe('hap-ble');

    const pairingEv = events.find((e) => e.type === 'controller.pairing');
    expect(pairingEv?.message).toContain('no Wi-Fi credentials required');

    const devices = homeService.listDevices();
    const paired = devices.find((d) => d.id.includes('aabbccddee01'));
    expect(paired).toBeDefined();
    expect(paired?.connectivity.protocol).toBe('homekit');
    expect(paired?.connectivity.address).toBe('ble:ble-door-sensor');

    await app.close();
  });

  it('respects existing pairing ownership and rejects already-paired accessory (sf=0)', async () => {
    const dataDir = await createTempDir();
    const app = await createNestApp({ dataDirectory: dataDir, port: 0 });
    await app.listen(0);

    const hkService = app.get(HomeKitControllerService);
    const adapter = new HomeKitIpAdapter(hkService);
    const pin = '246-81-357';

    const ctx: CommissioningContext = {
      commissioningId: 'comm-hk-paired-1',
      homeId: 'home-test',
      parsedCode: parseSetupCode(pin),
      candidate: {
        agentId: 'lan-scanner',
        transport: 'lan',
        protocol: 'homekit',
        identifier: '11:22:33:44:55:66',
        name: 'Living Room Lamp',
        paired: true,
      },
      emit: () => {},
    };

    const result = await adapter.commission(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('already_paired');

    await app.close();
  });

  it('rejects candidate with setup hash mismatch', async () => {
    const dataDir = await createTempDir();
    const app = await createNestApp({ dataDirectory: dataDir, port: 0 });
    await app.listen(0);

    const hkService = app.get(HomeKitControllerService);
    const adapter = new HomeKitIpAdapter(hkService);
    const uri = 'X-HM://0081691935ABCD';

    const candidate: TestBleCandidate = {
      agentId: 'lan-scanner',
      transport: 'lan',
      protocol: 'homekit',
      identifier: '11:22:33:44:55:66',
      name: 'Wrong Accessory',
      paired: false,
      details: {
        id: '11:22:33:44:55:66',
        setupHash: 'ffffffff', // Mismatched hash
      },
    };
    const ctx: CommissioningContext = {
      commissioningId: 'comm-hk-hash-1',
      homeId: 'home-test',
      parsedCode: parseSetupCode(uri),
      candidate,
      emit: () => {},
    };

    const result = await adapter.commission(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('setup_hash_mismatch');

    await app.close();
  });

  it('rejects WAC-only accessories and cites the Apple MFi entitlement requirement', async () => {
    const dataDir = await createTempDir();
    const app = await createNestApp({ dataDirectory: dataDir, port: 0 });
    await app.listen(0);

    const hkService = app.get(HomeKitControllerService);
    const adapter = new HomeKitIpAdapter(hkService);
    const pin = '246-81-357';

    const candidate: TestBleCandidate = {
      agentId: 'lan-scanner',
      transport: 'lan',
      protocol: 'homekit',
      identifier: '11:22:33:44:55:77',
      name: 'WAC Accessory',
      paired: false,
      details: {
        serviceType: '_wac._tcp',
      },
    };
    const ctx: CommissioningContext = {
      commissioningId: 'comm-hk-wac-1',
      homeId: 'home-test',
      parsedCode: parseSetupCode(pin),
      candidate,
      emit: () => {},
    };

    const result = await adapter.commission(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('wac_unsupported');

    await app.close();
  });

  it('retains HAP pairings across cold Hub restart without re-pairing', async () => {
    const dataDir = await createTempDir();
    const pin = '031-45-154';
    const accessoryId = 'AA:BB:CC:DD:EE:99';

    // Phase 1: Boot Hub and pair HAP-BLE device
    {
      const app = await createNestApp({ dataDirectory: dataDir, port: 0 });
      await app.listen(0);

      const hkService = app.get(HomeKitControllerService);
      const homeService = app.get<StandaloneHomeService>(STANDALONE_HOME_SERVICE);
      const adapter = new HomeKitIpAdapter(hkService);

      const mockPeripheral = createMockHapBlePeripheral({
        id: 'ble-restart-test',
        pin,
        accessoryId,
      });

      const candidate: TestBleCandidate = {
        agentId: 'hub-ble',
        transport: 'ble',
        protocol: 'homekit',
        identifier: accessoryId,
        name: 'Restart Sensor',
        paired: false,
        peripheral: mockPeripheral,
      };
      const ctx: CommissioningContext = {
        commissioningId: 'comm-hk-restart-1',
        homeId: 'home-restart',
        parsedCode: parseSetupCode(pin),
        candidate,
        emit: () => {},
      };

      const res = await adapter.commission(ctx);
      expect(res.status).toBe('completed');
      expect(homeService.listDevices().some((d) => d.id.includes('aabbccddee99'))).toBe(true);

      await app.close();
    }

    // Phase 2: Cold restart Hub with the same SQLite database directory
    {
      const app = await createNestApp({ dataDirectory: dataDir, port: 0 });
      await app.listen(0);

      const hkService = app.get(HomeKitControllerService);
      const pairings = hkService.listPairings();
      expect(pairings.some((p) => p.accessoryId === 'AA:BB:CC:DD:EE:99')).toBe(true);

      await app.close();
    }
  });

  it('executes full REST API onboarding lifecycle for HomeKit via Hub endpoints', async () => {
    const dataDir = await createTempDir();
    const app = await createNestApp({ dataDirectory: dataDir, port: 0 });
    await app.listen(0);

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);
    const commService = app.get<CommissioningService>(CommissioningService);
    const pin = '031-45-154';
    const accessoryId = 'AA:BB:CC:DD:EE:55';

    const mockPeripheral = createMockHapBlePeripheral({
      id: 'ble-rest-sensor',
      pin,
      accessoryId,
    });

    // Register RadioAgent
    const agent: RadioAgent = {
      id: 'hub-ble-agent',
      platform: 'hub',
      async *scan() {
        const adv: TestBleCandidate = {
          agentId: 'hub-ble-agent',
          transport: 'ble',
          protocol: 'homekit',
          identifier: accessoryId,
          name: 'REST HomeKit Sensor',
          paired: false,
          peripheral: mockPeripheral,
        };
        yield adv;
      },
      async connect() {
        return {
          device: { agentId: 'hub-ble-agent', identifier: accessoryId, transport: 'ble' },
          async readCharacteristic(_s, char) {
            const r = await mockPeripheral.readCharacteristic(char);
            return r instanceof Uint8Array ? r : Uint8Array.from(r);
          },
          async writeCharacteristic(_s, char, data) { await mockPeripheral.writeCharacteristic(char, data); },
          async subscribeCharacteristic() { return () => {}; },
          async close() {},
        };
      },
    };
    commService.radios.register(agent);

    // 3-step auth pairing to obtain token
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
    const authHeaders = {
      authorization: `Bearer ${token}`,
      'x-haus-home-id': confirmed.grant.homeId,
      'content-type': 'application/json',
    };

    // POST /api/commissioning/sessions
    const createRes = await fetch(`${base}/api/commissioning/sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ code: pin, homeId: confirmed.grant.homeId }),
    });
    expect(createRes.status).toBe(202);
    const created = await createRes.json();
    const sessionId = created.commissioningId;

    // GET /api/commissioning/sessions/:id
    const getRes = await fetch(`${base}/api/commissioning/sessions/${sessionId}`, {
      headers: authHeaders,
    });
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.state).toBe('LAN_DISCOVERY');
    expect(fetched.parsedCode.protocol).toBe('homekit');

    await app.close();
  });
});
