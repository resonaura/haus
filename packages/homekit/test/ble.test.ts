/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  HAP_PAIRING_SERVICE_UUID,
  HAP_PAIR_SETUP_CHAR_UUID,
  HAP_PAIR_VERIFY_CHAR_UUID,
  HapBleOpcode,
  HapBlePacketReassembler,
  HapBleStatus,
  REJECTED_FED3_UUID,
  chunkHapBlePdu,
  classifyHomeKitAccessory,
  decodeHapBleResponsePdu,
  encodeHapBleRequestPdu,
  hapBleStatusToString,
  isRejectedFed3Uuid,
  parseHomeKitBleAdvertisement,
} from '@haus/core';
import {
  performHapBlePairSetup,
  performHapBlePairVerify,
  type HapBlePeripheral,
} from '../src/hap-client/ble.js';
import {
  fastSrp,
  hapCrypto,
  hapTlv,
  HapTlvTag,
  type FastSrpServer,
} from '../src/hap-client/crypto.js';

describe('HomeKit BLE and Classification (P20.7)', () => {
  describe('Classification and Boundaries', () => {
    it('classifies online HAP-IP accessories without requiring Wi-Fi credentials', () => {
      const info = classifyHomeKitAccessory({
        transport: 'lan',
        serviceType: '_hap._tcp',
        flags: { ip: true, ble: false, wac: false },
      });
      expect(info.classification).toBe('hap-ip');
      expect(info.canDirectCommission).toBe(true);
      expect(info.requiresWifiCredentials).toBe(false);
      expect(info.guidance).toContain('Pair-Setup over HAP-IP');
    });

    it('classifies true HAP-BLE accessories honestly without Wi-Fi credentials', () => {
      const info = classifyHomeKitAccessory({
        transport: 'ble',
        flags: { ip: false, ble: true, wac: false },
      });
      expect(info.classification).toBe('hap-ble');
      expect(info.canDirectCommission).toBe(true);
      expect(info.requiresWifiCredentials).toBe(false);
      expect(info.guidance).toContain('does not require Wi-Fi credentials');
    });

    it('classifies WAC-only accessories and cites the MFi entitlement boundary', () => {
      const info = classifyHomeKitAccessory({
        flags: { ip: false, ble: false, wac: true },
      });
      expect(info.classification).toBe('wac-only');
      expect(info.canDirectCommission).toBe(false);
      expect(info.requiresWifiCredentials).toBe(false);
      expect(info.guidance).toContain('com.apple.external-accessory.wireless-configuration');
    });

    it('classifies vendor SoftAP Wi-Fi requiring separate network handover', () => {
      const info = classifyHomeKitAccessory({
        transport: 'softap',
      });
      expect(info.classification).toBe('vendor-softap');
      expect(info.canDirectCommission).toBe(false);
      expect(info.requiresWifiCredentials).toBe(true);
    });

    it('classifies HAP-BLE with vendor Wi-Fi characteristic as requiring credentials', () => {
      const info = classifyHomeKitAccessory({
        transport: 'ble',
        hasVendorWifiCharacteristic: true,
      });
      expect(info.classification).toBe('vendor-wifi-ble');
      expect(info.canDirectCommission).toBe(true);
      expect(info.requiresWifiCredentials).toBe(true);
    });
  });

  describe('0xFED3 Rejection and Canonical UUIDs', () => {
    it('explicitly rejects 0xFED3 as HAP pairing discovery criterion', () => {
      expect(isRejectedFed3Uuid('fed3')).toBe(true);
      expect(isRejectedFed3Uuid('0000fed3-0000-1000-8000-00805f9b34fb')).toBe(true);
      expect(isRejectedFed3Uuid('FED3')).toBe(true);
      expect(isRejectedFed3Uuid(HAP_PAIRING_SERVICE_UUID)).toBe(false);
      expect(REJECTED_FED3_UUID).toBe('fed3');
    });

    it('verifies canonical HAP Pairing service and characteristic UUIDs', () => {
      expect(HAP_PAIRING_SERVICE_UUID.toLowerCase()).toBe('00000055-0000-1000-8000-0026bb765291');
      expect(HAP_PAIR_SETUP_CHAR_UUID.toLowerCase()).toBe('0000004c-0000-1000-8000-0026bb765291');
      expect(HAP_PAIR_VERIFY_CHAR_UUID.toLowerCase()).toBe('0000004e-0000-1000-8000-0026bb765291');
    });
  });

  describe('BLE Advertisement Parsing', () => {
    it('parses valid unpaired HomeKit BLE manufacturer advertisement (sf=1)', () => {
      // 0x004C (Apple), Subtype 0x06, Len 17, SF=0x01 (unpaired), MAC=11:22:33:44:55:66, Cat=2 (Bridge), s#=1, c#=1, pv=1, sh=abcd1234
      const adv = new Uint8Array([
        0x4c,
        0x00, // Apple Company ID
        0x06, // Subtype HomeKit
        17, // Length
        0x01, // SF (bit 0 = 1 -> unpaired)
        0x11,
        0x22,
        0x33,
        0x44,
        0x55,
        0x66, // Device ID / MAC
        0x02,
        0x00, // Category ID 2
        0x01,
        0x00, // Global state number 1
        0x01, // Config number 1
        0x01, // Protocol version 1
        0xab,
        0xcd,
        0x12,
        0x34, // Setup Hash
      ]);

      const parsed = parseHomeKitBleAdvertisement(adv);
      expect(parsed).not.toBeNull();
      expect(parsed?.paired).toBe(false);
      expect(parsed?.deviceId).toBe('11:22:33:44:55:66');
      expect(parsed?.categoryId).toBe(2);
      expect(parsed?.globalStateNumber).toBe(1);
      expect(parsed?.configNumber).toBe(1);
      expect(parsed?.setupHash).toBe('abcd1234');
    });

    it('detects already-paired HomeKit BLE accessory (sf=0)', () => {
      const adv = new Uint8Array([
        0x4c,
        0x00,
        0x06,
        17,
        0x00, // SF bit 0 = 0 -> paired
        0xaa,
        0xbb,
        0xcc,
        0xdd,
        0xee,
        0xff,
        0x05,
        0x00, // Category 5 (Lightbulb)
        0x04,
        0x00,
        0x02,
        0x01,
        0x00,
        0x00,
        0x00,
        0x00,
      ]);

      const parsed = parseHomeKitBleAdvertisement(adv);
      expect(parsed).not.toBeNull();
      expect(parsed?.paired).toBe(true);
      expect(parsed?.deviceId).toBe('AA:BB:CC:DD:EE:FF');
    });

    it('rejects non-HomeKit manufacturer data', () => {
      const nonHap = new Uint8Array([0x4c, 0x00, 0x02, 0x05, 0x01, 0x02]);
      expect(parseHomeKitBleAdvertisement(nonHap)).toBeNull();
    });
  });

  describe('HAP-BLE PDU Framing & Reassembly', () => {
    it('encodes and decodes HAP-BLE request/response PDUs', () => {
      const body = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const req = encodeHapBleRequestPdu({
        opcode: HapBleOpcode.CharacteristicWrite,
        tid: 42,
        iid: 16,
        body,
      });

      expect(req[0]).toBe(0x00); // control
      expect(req[1]).toBe(HapBleOpcode.CharacteristicWrite);
      expect(req[2]).toBe(42); // tid
      expect(req[3]).toBe(16); // iid low
      expect(req[4]).toBe(0); // iid high
      expect(req[5]).toBe(4); // body len low
      expect(req[6]).toBe(0); // body len high
      expect(Array.from(req.slice(7))).toEqual([1, 2, 3, 4]);

      // Decode response
      const respPdu = new Uint8Array([
        0x00, // control
        42, // tid
        HapBleStatus.Success,
        0x02,
        0x00, // body length 2
        0xca,
        0xfe, // body
      ]);
      const resp = decodeHapBleResponsePdu(respPdu);
      expect(resp.tid).toBe(42);
      expect(resp.status).toBe(HapBleStatus.Success);
      expect(Array.from(resp.body)).toEqual([0xca, 0xfe]);
      expect(hapBleStatusToString(resp.status)).toBe('success');
    });

    it('chunks and reassembles fragmented HAP-BLE packets', () => {
      const payload = new Uint8Array(65).fill(0x5a);
      const chunks = chunkHapBlePdu(payload, 20);
      expect(chunks).toHaveLength(4);
      expect(chunks[0].length).toBe(20);
      expect(chunks[3].length).toBe(5);

      const reassembler = new HapBlePacketReassembler();
      // Packet with 5-byte header indicating 20 bytes body (total 25)
      const full = new Uint8Array(25);
      full[0] = 0x00;
      full[1] = 1;
      full[2] = 0;
      full[3] = 20; // body len
      full[4] = 0;
      full.fill(0xaa, 5);

      const chunk1 = full.slice(0, 15);
      const chunk2 = full.slice(15);

      expect(reassembler.append(chunk1)).toBeNull();
      const result = reassembler.append(chunk2);
      expect(result).not.toBeNull();
      expect(result?.length).toBe(25);
    });
  });

  describe('HAP-BLE Pair-Setup & Pair-Verify (M1..M6 / M1..M4)', () => {
    it('executes real HAP-BLE Pair Setup and Pair Verify against mock peripheral', async () => {
      const pin = '031-45-154';
      const accessoryId = '12:34:56:78:9A:BC';

      // Accessory long-term keys
      const accKeys = hapCrypto.generateEd25519KeyPair();
      const accLtpk = Buffer.from(accKeys.publicKey);
      const accLtsk = Buffer.from(accKeys.secretKey);

      // Accessory SRP server state
      let srpServer: FastSrpServer | undefined;
      let sessionKey: Buffer;
      let sharedSecret: Buffer;

      const gattStorage = new Map<string, Uint8Array>();

      const mockPeripheral: HapBlePeripheral = {
        id: 'mock-ble-1',
        name: 'Mock HomeKit Sensor',
        serviceUuids: [HAP_PAIRING_SERVICE_UUID],
        readCharacteristic: async (uuid: string) => {
          return gattStorage.get(uuid) ?? new Uint8Array(0);
        },
        writeCharacteristic: async (uuid: string, data: Uint8Array | number[]) => {
          const buf = Buffer.from(data);
          const tlv = hapTlv.decode(buf);

          if (uuid === HAP_PAIR_SETUP_CHAR_UUID) {
            const state = tlv[HapTlvTag.State]?.[0];
            if (state === 1) {
              // M1 received -> respond with M2 (Salt, B)
              const salt = Buffer.from('1234567890abcdef1234567890abcdef', 'hex');
              const secret2 = await fastSrp.SRP.genKey(32);
              srpServer = new fastSrp.SrpServer(
                fastSrp.SRP.params.hap,
                salt,
                Buffer.from('Pair-Setup'),
                Buffer.from(pin.trim()),
                secret2,
              );
              const B = srpServer.computeB();
              const m2 = hapTlv.encode(
                HapTlvTag.State,
                2,
                HapTlvTag.PublicKey,
                B,
                HapTlvTag.Salt,
                salt,
              );
              gattStorage.set(HAP_PAIR_SETUP_CHAR_UUID, Uint8Array.from(m2));
            } else if (state === 3) {
              // M3 received (A, M1) -> respond with M4 (M2 proof)
              if (!srpServer) throw new Error('srp_server_not_initialized');
              const A = tlv[HapTlvTag.PublicKey];
              const M1_client = tlv[HapTlvTag.Proof];
              srpServer.setA(A);
              srpServer.checkM1(M1_client);
              const M2_proof = srpServer.computeM2();
              const K = srpServer.computeK();

              sessionKey = hapCrypto.HKDF(
                'sha512',
                Buffer.from('Pair-Setup-Encrypt-Salt'),
                K,
                Buffer.from('Pair-Setup-Encrypt-Info'),
                32,
              );

              const m4 = hapTlv.encode(HapTlvTag.State, 4, HapTlvTag.Proof, M2_proof);
              gattStorage.set(HAP_PAIR_SETUP_CHAR_UUID, Uint8Array.from(m4));
            } else if (state === 5) {
              // M5 received -> verify controller, respond with M6
              if (!srpServer) throw new Error('srp_server_not_initialized');
              const signInfo = hapCrypto.HKDF(
                'sha512',
                Buffer.from('Pair-Setup-Accessory-Sign-Salt'),
                srpServer.computeK(),
                Buffer.from('Pair-Setup-Accessory-Sign-Info'),
                32,
              );
              const accMat = Buffer.concat([signInfo, Buffer.from(accessoryId), accLtpk]);
              const accSig = hapCrypto.ed25519Sign(accMat, accLtsk);

              const subTlv = hapTlv.encode(
                HapTlvTag.Identifier,
                Buffer.from(accessoryId),
                HapTlvTag.PublicKey,
                accLtpk,
                HapTlvTag.Signature,
                accSig,
              );

              const enc = hapCrypto.chacha20_poly1305_encryptAndSeal(
                sessionKey,
                Buffer.from('PS-Msg06', 'utf8'),
                null,
                subTlv,
              );
              const m6 = hapTlv.encode(
                HapTlvTag.State,
                6,
                HapTlvTag.EncryptedData,
                Buffer.concat([enc.ciphertext, enc.authTag]),
              );
              gattStorage.set(HAP_PAIR_SETUP_CHAR_UUID, Uint8Array.from(m6));
            }
          } else if (uuid === HAP_PAIR_VERIFY_CHAR_UUID) {
            const state = tlv[HapTlvTag.State]?.[0];
            if (state === 1) {
              // M1 -> respond M2
              const accEphemeral = hapCrypto.generateCurve25519KeyPair();
              const serverEphemeralPub = Buffer.from(accEphemeral.publicKey);
              const clientEphemeralPub = tlv[HapTlvTag.PublicKey];

              sharedSecret = Buffer.from(
                hapCrypto.generateCurve25519SharedSecKey(
                  accEphemeral.secretKey,
                  clientEphemeralPub,
                ),
              );

              const pvSessionKey = hapCrypto.HKDF(
                'sha512',
                Buffer.from('Pair-Verify-Encrypt-Salt'),
                sharedSecret,
                Buffer.from('Pair-Verify-Encrypt-Info'),
                32,
              );

              const accMat = Buffer.concat([
                serverEphemeralPub,
                Buffer.from(accessoryId),
                clientEphemeralPub,
              ]);
              const sig = hapCrypto.ed25519Sign(accMat, accLtsk);
              const sub = hapTlv.encode(
                HapTlvTag.Identifier,
                Buffer.from(accessoryId),
                HapTlvTag.Signature,
                sig,
              );
              const enc = hapCrypto.chacha20_poly1305_encryptAndSeal(
                pvSessionKey,
                Buffer.from('PV-Msg02', 'utf8'),
                null,
                sub,
              );
              const m2 = hapTlv.encode(
                HapTlvTag.State,
                2,
                HapTlvTag.PublicKey,
                serverEphemeralPub,
                HapTlvTag.EncryptedData,
                Buffer.concat([enc.ciphertext, enc.authTag]),
              );
              gattStorage.set(HAP_PAIR_VERIFY_CHAR_UUID, Uint8Array.from(m2));
            } else if (state === 3) {
              // M3 -> respond M4
              const m4 = hapTlv.encode(HapTlvTag.State, 4);
              gattStorage.set(HAP_PAIR_VERIFY_CHAR_UUID, Uint8Array.from(m4));
            }
          }
        },
      };

      const pairing = await performHapBlePairSetup({
        peripheral: mockPeripheral,
        pin,
      });

      expect(pairing.accessoryId).toBe(accessoryId);
      expect(pairing.address).toBe('ble:mock-ble-1');
      expect(pairing.controllerLtpk).toBeTruthy();
      expect(pairing.accessoryLtpk).toBe(accLtpk.toString('hex'));

      // Pair Verify
      const session = await performHapBlePairVerify(mockPeripheral, pairing);
      expect(session.accessoryId).toBe(accessoryId);
      session.close();
    });

    it('rejects pairing when peripheral advertises rejected 0xFED3 service', async () => {
      const peripheral: HapBlePeripheral = {
        id: 'mock-fed3',
        serviceUuids: ['fed3'],
        readCharacteristic: async () => new Uint8Array(0),
        writeCharacteristic: async () => {},
      };
      await expect(performHapBlePairSetup({ peripheral, pin: '123-45-678' })).rejects.toThrow(
        /rejected_fed3_uuid/,
      );
    });

    it('rejects pair setup when accessory reports already paired (0x02)', async () => {
      const peripheral: HapBlePeripheral = {
        id: 'mock-paired',
        serviceUuids: [HAP_PAIRING_SERVICE_UUID],
        readCharacteristic: async () => {
          return Uint8Array.from(hapTlv.encode(HapTlvTag.Error, 2));
        },
        writeCharacteristic: async () => {},
      };
      await expect(performHapBlePairSetup({ peripheral, pin: '123-45-678' })).rejects.toThrow(
        /already_paired/,
      );
    });
  });
});
