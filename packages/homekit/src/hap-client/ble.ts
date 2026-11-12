/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import {
  HAP_PAIR_SETUP_CHAR_UUID,
  HAP_PAIR_VERIFY_CHAR_UUID,
  isRejectedFed3Uuid,
} from '@haus/core';
import { fastSrp, hapCrypto, hapTlv, HapTlvTag, type HapEncryptionState } from './crypto.js';
import type { HapPairingRecord } from './session.js';

export interface HapBlePeripheral {
  readonly id: string;
  readonly name?: string;
  readonly serviceUuids?: readonly string[];
  readCharacteristic(uuid: string): Promise<Uint8Array | number[]>;
  writeCharacteristic(uuid: string, data: Uint8Array | number[]): Promise<void>;
  readDescriptor?(charUuid: string, descUuid: string): Promise<Uint8Array | number[]>;
}

export interface HapBleSession {
  readonly accessoryId: string;
  readCharacteristic(charUuid: string, iid?: number): Promise<Uint8Array>;
  writeCharacteristic(charUuid: string, data: Uint8Array, iid?: number): Promise<void>;
  close(): void;
}

/**
 * Executes HomeKit Pair-Setup over BLE against the standard Apple HAP Pairing service
 * (00000055-0000-1000-8000-0026BB765291) and Pair Setup characteristic (0000004C-...).
 *
 * Invariants:
 * - 0xFED3 is explicitly rejected as pairing criterion.
 * - Respects existing pairing ownership; fails if accessory is already paired.
 * - HAP-BLE communicates permanently over BLE; no Wi-Fi credentials are sent.
 */
export async function performHapBlePairSetup(options: {
  peripheral: HapBlePeripheral;
  pin: string;
  controllerId?: string;
}): Promise<HapPairingRecord> {
  const { peripheral, pin } = options;

  if (peripheral.serviceUuids) {
    for (const u of peripheral.serviceUuids) {
      if (isRejectedFed3Uuid(u)) {
        throw new Error('rejected_fed3_uuid: 0xFED3 is not the HAP pairing service');
      }
    }
  }

  const controllerId = options.controllerId ?? randomUUID();
  const pinBuf = Buffer.from(pin.trim(), 'utf8');

  // Read Pairing Features to confirm readiness and verify un-paired status
  try {
    const featRaw = await peripheral.readCharacteristic(HAP_PAIR_SETUP_CHAR_UUID);
    const featBuf = Buffer.from(featRaw);
    if (featBuf.length > 0) {
      const decoded = hapTlv.decode(featBuf);
      const err = decoded[HapTlvTag.Error];
      if (err && err.length > 0 && err[0] === 0x02) {
        throw new Error('already_paired: accessory is already paired to another controller');
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already_paired')) throw err;
  }

  // --- M1: Controller -> Accessory (Method=0, State=1) ---
  const m1 = hapTlv.encode(HapTlvTag.Method, 0, HapTlvTag.State, 1);
  await peripheral.writeCharacteristic(HAP_PAIR_SETUP_CHAR_UUID, Uint8Array.from(m1));

  // --- M2: Accessory -> Controller (State=2, Salt, B) ---
  const m2Raw = await peripheral.readCharacteristic(HAP_PAIR_SETUP_CHAR_UUID);
  const m2 = hapTlv.decode(Buffer.from(m2Raw));
  if (m2[HapTlvTag.Error]) {
    const errCode = m2[HapTlvTag.Error][0];
    if (errCode === 0x02) {
      throw new Error('already_paired: accessory is already paired with another controller');
    }
    throw new Error(`hap_ble_tlv_error_${errCode}`);
  }

  const salt = m2[HapTlvTag.Salt];
  const B = m2[HapTlvTag.PublicKey];
  if (!salt || !B) {
    throw new Error('hap_ble_pair_setup_m2_missing_salt_or_b');
  }

  // SRP Calculation
  const srpClient = new fastSrp.SrpClient(
    fastSrp.SRP.params.hap,
    salt,
    Buffer.from('Pair-Setup'),
    pinBuf,
    await fastSrp.SRP.genKey(32),
    true,
  );
  srpClient.setB(B);
  const A = srpClient.computeA();
  const M1_proof = srpClient.computeM1();
  const K = srpClient.computeK();

  // --- M3: Controller -> Accessory (State=3, A, M1) ---
  const m3 = hapTlv.encode(HapTlvTag.State, 3, HapTlvTag.PublicKey, A, HapTlvTag.Proof, M1_proof);
  await peripheral.writeCharacteristic(HAP_PAIR_SETUP_CHAR_UUID, Uint8Array.from(m3));

  // --- M4: Accessory -> Controller (State=4, M2) ---
  const m4Raw = await peripheral.readCharacteristic(HAP_PAIR_SETUP_CHAR_UUID);
  const m4 = hapTlv.decode(Buffer.from(m4Raw));
  if (m4[HapTlvTag.Error]) {
    const errCode = m4[HapTlvTag.Error][0];
    throw new Error(errCode === 0x02 ? 'already_paired' : `hap_ble_auth_failed_error_${errCode}`);
  }

  const M2_proof = m4[HapTlvTag.Proof];
  if (!M2_proof) {
    throw new Error('hap_ble_pair_setup_m4_missing_m2_proof');
  }
  srpClient.checkM2(M2_proof);

  // Derive encryption session key
  const sessionKey = hapCrypto.HKDF(
    'sha512',
    Buffer.from('Pair-Setup-Encrypt-Salt'),
    K,
    Buffer.from('Pair-Setup-Encrypt-Info'),
    32,
  );

  // Generate Controller Long-Term Ed25519 Keypair
  const controllerKeys = hapCrypto.generateEd25519KeyPair();
  const controllerLtpk = Buffer.from(controllerKeys.publicKey);
  const controllerLtsk = Buffer.from(controllerKeys.secretKey);

  const accessoryLtpkInfo = hapCrypto.HKDF(
    'sha512',
    Buffer.from('Pair-Setup-Controller-Sign-Salt'),
    K,
    Buffer.from('Pair-Setup-Controller-Sign-Info'),
    32,
  );

  const materialToSign = Buffer.concat([
    accessoryLtpkInfo,
    Buffer.from(controllerId),
    controllerLtpk,
  ]);
  const signature = hapCrypto.ed25519Sign(materialToSign, controllerLtsk);

  const subTlv = hapTlv.encode(
    HapTlvTag.Identifier,
    Buffer.from(controllerId),
    HapTlvTag.PublicKey,
    controllerLtpk,
    HapTlvTag.Signature,
    signature,
  );

  const encrypted = hapCrypto.chacha20_poly1305_encryptAndSeal(
    sessionKey,
    Buffer.from('PS-Msg05', 'utf8'),
    null,
    subTlv,
  );

  // --- M5: Controller -> Accessory (State=5, EncryptedData) ---
  const m5 = hapTlv.encode(
    HapTlvTag.State,
    5,
    HapTlvTag.EncryptedData,
    Buffer.concat([encrypted.ciphertext, encrypted.authTag]),
  );
  await peripheral.writeCharacteristic(HAP_PAIR_SETUP_CHAR_UUID, Uint8Array.from(m5));

  // --- M6: Accessory -> Controller (State=6, EncryptedData) ---
  const m6Raw = await peripheral.readCharacteristic(HAP_PAIR_SETUP_CHAR_UUID);
  const m6 = hapTlv.decode(Buffer.from(m6Raw));
  if (m6[HapTlvTag.Error]) {
    throw new Error(`hap_ble_tlv_error_${m6[HapTlvTag.Error][0]}`);
  }

  const encData = m6[HapTlvTag.EncryptedData];
  if (!encData || encData.length < 16) {
    throw new Error('hap_ble_pair_setup_m6_missing_encrypted_data');
  }

  const ciphertext = encData.subarray(0, encData.length - 16);
  const authTag = encData.subarray(encData.length - 16);

  const decrypted = hapCrypto.chacha20_poly1305_decryptAndVerify(
    sessionKey,
    Buffer.from('PS-Msg06', 'utf8'),
    null,
    ciphertext,
    authTag,
  );

  const m6Sub = hapTlv.decode(decrypted);
  const accessoryIdBuf = m6Sub[HapTlvTag.Identifier];
  const accessoryLtpk = m6Sub[HapTlvTag.PublicKey];
  const accessorySig = m6Sub[HapTlvTag.Signature];

  if (!accessoryIdBuf || !accessoryLtpk || !accessorySig) {
    throw new Error('hap_ble_pair_setup_m6_subtlv_incomplete');
  }

  const accessorySignInfo = hapCrypto.HKDF(
    'sha512',
    Buffer.from('Pair-Setup-Accessory-Sign-Salt'),
    K,
    Buffer.from('Pair-Setup-Accessory-Sign-Info'),
    32,
  );
  const accessoryMaterialToVerify = Buffer.concat([
    accessorySignInfo,
    accessoryIdBuf,
    accessoryLtpk,
  ]);

  const verified = hapCrypto.ed25519Verify(accessoryMaterialToVerify, accessorySig, accessoryLtpk);
  if (!verified) {
    throw new Error('hap_ble_accessory_signature_verification_failed');
  }

  const accessoryId = accessoryIdBuf.toString('utf8');

  return {
    accessoryId,
    address: `ble:${peripheral.id}`,
    port: 0,
    controllerId,
    controllerLtsk: controllerLtsk.toString('hex'),
    controllerLtpk: controllerLtpk.toString('hex'),
    accessoryLtpk: accessoryLtpk.toString('hex'),
  };
}

/**
 * Performs HomeKit Pair-Verify over BLE on characteristic 0x004E and opens an encrypted session.
 */
export async function performHapBlePairVerify(
  peripheral: HapBlePeripheral,
  pairing: HapPairingRecord,
): Promise<HapBleSession> {
  const curvePair = hapCrypto.generateCurve25519KeyPair();
  const clientEphemeralPub = Buffer.from(curvePair.publicKey);
  const clientEphemeralPri = Buffer.from(curvePair.secretKey);

  // M1: State=1, PublicKey
  const m1 = hapTlv.encode(HapTlvTag.State, 1, HapTlvTag.PublicKey, clientEphemeralPub);
  await peripheral.writeCharacteristic(HAP_PAIR_VERIFY_CHAR_UUID, Uint8Array.from(m1));

  // M2: State=2, PublicKey, EncryptedData
  const m2Raw = await peripheral.readCharacteristic(HAP_PAIR_VERIFY_CHAR_UUID);
  const m2 = hapTlv.decode(Buffer.from(m2Raw));
  if (m2[HapTlvTag.Error]) {
    throw new Error(`hap_ble_pair_verify_m2_error_${m2[HapTlvTag.Error][0]}`);
  }

  const serverEphemeralPub = m2[HapTlvTag.PublicKey];
  const encData = m2[HapTlvTag.EncryptedData];
  if (!serverEphemeralPub || !encData || encData.length < 16) {
    throw new Error('hap_ble_pair_verify_m2_incomplete');
  }

  const sharedSecret = Buffer.from(
    hapCrypto.generateCurve25519SharedSecKey(clientEphemeralPri, serverEphemeralPub),
  );

  const sessionKey = hapCrypto.HKDF(
    'sha512',
    Buffer.from('Pair-Verify-Encrypt-Salt'),
    sharedSecret,
    Buffer.from('Pair-Verify-Encrypt-Info'),
    32,
  );

  const ciphertext = encData.subarray(0, encData.length - 16);
  const authTag = encData.subarray(encData.length - 16);

  const decrypted = hapCrypto.chacha20_poly1305_decryptAndVerify(
    sessionKey,
    Buffer.from('PV-Msg02', 'utf8'),
    null,
    ciphertext,
    authTag,
  );

  const m2Sub = hapTlv.decode(decrypted);
  const accessoryIdBuf = m2Sub[HapTlvTag.Identifier];
  const accessorySig = m2Sub[HapTlvTag.Signature];
  const accessoryLtpk = Buffer.from(pairing.accessoryLtpk, 'hex');

  const accMat = Buffer.concat([serverEphemeralPub, accessoryIdBuf, clientEphemeralPub]);
  if (!hapCrypto.ed25519Verify(accMat, accessorySig, accessoryLtpk)) {
    throw new Error('hap_ble_pair_verify_signature_mismatch');
  }

  // M3: State=3, EncryptedData
  const controllerLtsk = Buffer.from(pairing.controllerLtsk, 'hex');
  const ctrlMat = Buffer.concat([
    clientEphemeralPub,
    Buffer.from(pairing.controllerId),
    serverEphemeralPub,
  ]);
  const ctrlSig = hapCrypto.ed25519Sign(ctrlMat, controllerLtsk);
  const subTlv = hapTlv.encode(
    HapTlvTag.Identifier,
    Buffer.from(pairing.controllerId),
    HapTlvTag.Signature,
    ctrlSig,
  );

  const m3Enc = hapCrypto.chacha20_poly1305_encryptAndSeal(
    sessionKey,
    Buffer.from('PV-Msg03', 'utf8'),
    null,
    subTlv,
  );
  const m3 = hapTlv.encode(
    HapTlvTag.State,
    3,
    HapTlvTag.EncryptedData,
    Buffer.concat([m3Enc.ciphertext, m3Enc.authTag]),
  );
  await peripheral.writeCharacteristic(HAP_PAIR_VERIFY_CHAR_UUID, Uint8Array.from(m3));

  // M4: State=4
  const m4Raw = await peripheral.readCharacteristic(HAP_PAIR_VERIFY_CHAR_UUID);
  const m4 = hapTlv.decode(Buffer.from(m4Raw));
  if (m4[HapTlvTag.Error]) {
    throw new Error(`hap_ble_pair_verify_m4_error_${m4[HapTlvTag.Error][0]}`);
  }

  const accessoryToControllerKey = hapCrypto.HKDF(
    'sha512',
    Buffer.from('Control-Salt'),
    sharedSecret,
    Buffer.from('Control-Read-Encryption-Key'),
    32,
  );
  const controllerToAccessoryKey = hapCrypto.HKDF(
    'sha512',
    Buffer.from('Control-Salt'),
    sharedSecret,
    Buffer.from('Control-Write-Encryption-Key'),
    32,
  );

  const encryption: HapEncryptionState = {
    accessoryToControllerKey,
    controllerToAccessoryKey,
    accessoryToControllerCount: 0,
    controllerToAccessoryCount: 0,
  };

  return {
    accessoryId: pairing.accessoryId,
    readCharacteristic: async (charUuid: string): Promise<Uint8Array> => {
      const raw = await peripheral.readCharacteristic(charUuid);
      const buf = Buffer.from(raw);
      if (buf.length < 16) return buf;
      try {
        const decrypted = hapCrypto.layerDecrypt(buf, encryption);
        return Uint8Array.from(decrypted);
      } catch {
        return Uint8Array.from(buf);
      }
    },
    writeCharacteristic: async (charUuid: string, data: Uint8Array): Promise<void> => {
      const encrypted = hapCrypto.layerEncrypt(Buffer.from(data), encryption);
      await peripheral.writeCharacteristic(charUuid, Uint8Array.from(encrypted));
    },
    close: () => {},
  };
}
