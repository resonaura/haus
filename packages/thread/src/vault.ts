/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ThreadDataset } from './types.js';

export interface EncryptedDatasetEnvelope {
  readonly algorithm: 'AES-256-GCM';
  readonly iv: string; // Hex
  readonly ciphertext: string; // Hex
  readonly authTag: string; // Hex
  readonly createdAt: string;
}

/**
 * Thread Type-Length-Value (TLV) identifiers defined in the Thread specification.
 */
export const ThreadTlvType = {
  Channel: 0x00,
  PanId: 0x01,
  ExtendedPanId: 0x02,
  NetworkName: 0x03,
  Pskc: 0x04,
  NetworkKey: 0x05,
  MeshLocalPrefix: 0x07,
} as const;

/**
 * Hardware/software-encrypted vault managing persistent Thread Active Operational Datasets.
 * Ensures Thread network credentials never transit external cloud services.
 */
export class ThreadCredentialVault {
  /**
   * Encrypts and envelopes a ThreadDataset using AES-256-GCM.
   */
  public async storeDataset(
    dataset: ThreadDataset,
    vaultKey: Buffer | Uint8Array,
  ): Promise<EncryptedDatasetEnvelope> {
    const key = Buffer.isBuffer(vaultKey) ? vaultKey : Buffer.from(vaultKey);
    if (key.length !== 32) {
      throw new Error('Vault encryption key must be exactly 32 bytes (256-bit)');
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(dataset), 'utf8');

    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      algorithm: 'AES-256-GCM',
      iv: iv.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      authTag: authTag.toString('hex'),
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Decrypts an encrypted dataset envelope.
   */
  public async retrieveDataset(
    envelope: EncryptedDatasetEnvelope,
    vaultKey: Buffer | Uint8Array,
  ): Promise<ThreadDataset> {
    const key = Buffer.isBuffer(vaultKey) ? vaultKey : Buffer.from(vaultKey);
    if (key.length !== 32) {
      throw new Error('Vault encryption key must be exactly 32 bytes (256-bit)');
    }

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8')) as ThreadDataset;
  }

  /**
   * Serializes a Thread operational dataset into a standard Thread Active Operational Dataset TLV buffer.
   */
  public exportRawActiveOperationalDataset(dataset: ThreadDataset): Buffer {
    const tlvs: Buffer[] = [];

    // Network Name TLV (Type 0x03)
    const nameBuf = Buffer.from(dataset.networkName, 'utf8');
    tlvs.push(Buffer.concat([Buffer.from([ThreadTlvType.NetworkName, nameBuf.length]), nameBuf]));

    // Channel TLV (Type 0x00: page 0 (1 byte) + channel (2 bytes BE))
    const chanBuf = Buffer.alloc(3);
    chanBuf.writeUInt8(0, 0); // Channel page 0
    chanBuf.writeUInt16BE(dataset.channel, 1);
    tlvs.push(Buffer.concat([Buffer.from([ThreadTlvType.Channel, 3]), chanBuf]));

    // PAN ID TLV (Type 0x01: 2 bytes BE)
    const panBuf = Buffer.alloc(2);
    panBuf.writeUInt16BE(dataset.panId, 0);
    tlvs.push(Buffer.concat([Buffer.from([ThreadTlvType.PanId, 2]), panBuf]));

    // Extended PAN ID TLV (Type 0x02: 8 bytes)
    const extPanBuf = Buffer.from(dataset.extendedPanId, 'hex');
    tlvs.push(
      Buffer.concat([Buffer.from([ThreadTlvType.ExtendedPanId, extPanBuf.length]), extPanBuf]),
    );

    // Network Key TLV (Type 0x05: 16 bytes)
    const keyBuf = Buffer.from(dataset.networkKey, 'hex');
    tlvs.push(Buffer.concat([Buffer.from([ThreadTlvType.NetworkKey, keyBuf.length]), keyBuf]));

    return Buffer.concat(tlvs);
  }

  /**
   * Parses standard Thread TLVs into a canonical ThreadDataset.
   */
  public importRawActiveOperationalDataset(rawTlv: Buffer | Uint8Array | string): ThreadDataset {
    const buf = Buffer.isBuffer(rawTlv)
      ? rawTlv
      : typeof rawTlv === 'string'
        ? Buffer.from(rawTlv.replace(/^0x/i, ''), 'hex')
        : Buffer.from(rawTlv);

    let offset = 0;
    let networkName = 'Imported-Thread';
    let channel = 15;
    let panId = 0x1234;
    let extendedPanId = '0011223344556677';
    let networkKey = '00112233445566778899aabbccddeeff';

    while (offset < buf.length) {
      if (offset + 2 > buf.length) break;
      const type = buf.readUInt8(offset);
      const len = buf.readUInt8(offset + 1);
      offset += 2;

      if (offset + len > buf.length) break;
      const val = buf.subarray(offset, offset + len);
      offset += len;

      switch (type) {
        case ThreadTlvType.NetworkName:
          networkName = val.toString('utf8');
          break;
        case ThreadTlvType.Channel:
          if (len >= 3) {
            channel = val.readUInt16BE(1);
          }
          break;
        case ThreadTlvType.PanId:
          if (len >= 2) {
            panId = val.readUInt16BE(0);
          }
          break;
        case ThreadTlvType.ExtendedPanId:
          extendedPanId = val.toString('hex');
          break;
        case ThreadTlvType.NetworkKey:
          networkKey = val.toString('hex');
          break;
      }
    }

    return {
      networkName,
      channel,
      panId,
      extendedPanId,
      networkKey,
      meshLocalPrefix: 'fd00:7d03:7d03::/64',
    };
  }
}
