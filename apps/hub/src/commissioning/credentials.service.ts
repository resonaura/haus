/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type CredentialCipher,
  EncryptedNetworkCredentialStore,
  type StoredThreadDataset,
  type StoredWifiCredential,
  SystemAssistedThreadManager,
  type SystemNetworkInfo,
  type SystemThreadDatasetResult,
  type SystemThreadProvider,
} from '@haus/core';

/**
 * AES-256-GCM cipher for encrypting stored network secrets in Hub local storage.
 * Output format: ivHex:authTagHex:ciphertextHex
 */
export class AesGcmCredentialCipher implements CredentialCipher {
  private readonly key: Buffer;

  constructor(keyMaterial?: Buffer | string) {
    if (keyMaterial) {
      if (typeof keyMaterial === 'string') {
        this.key = createHash('sha256').update(keyMaterial).digest();
      } else if (keyMaterial.length === 32) {
        this.key = keyMaterial;
      } else {
        this.key = createHash('sha256').update(keyMaterial).digest();
      }
    } else {
      const secret = process.env.HAUS_CREDENTIAL_KEY ?? 'haus-default-key-fallback';
      this.key = createHash('sha256').update(secret).digest();
    }
  }

  public async encrypt(plaintext: Uint8Array): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  public async decrypt(ciphertext: string): Promise<Uint8Array> {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('invalid_ciphertext_format');
    }
    const [ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return new Uint8Array(decrypted);
  }
}

/**
 * Hub network credential service managing encrypted storage of Wi-Fi credentials
 * and Thread datasets, prefilling current SSID with permission, and system Thread access.
 */
@Injectable()
export class HubNetworkCredentialService {
  private readonly logger = new Logger(HubNetworkCredentialService.name);
  private readonly cipher: AesGcmCredentialCipher;
  private readonly store: EncryptedNetworkCredentialStore;
  private threadManager: SystemAssistedThreadManager;
  private systemInfo: SystemNetworkInfo = {
    permissionStatus: 'unavailable',
    supportsPassphraseExtraction: false,
  };
  private otbrLoader?: () => Promise<Uint8Array | undefined>;
  private systemProvider?: SystemThreadProvider;

  constructor() {
    this.cipher = new AesGcmCredentialCipher();
    this.store = new EncryptedNetworkCredentialStore(this.cipher);
    this.threadManager = new SystemAssistedThreadManager();
  }

  public getSystemNetworkInfo(): SystemNetworkInfo {
    return { ...this.systemInfo, supportsPassphraseExtraction: false };
  }

  public setSystemNetworkInfo(patch: {
    ssid?: string;
    permissionStatus?: SystemNetworkInfo['permissionStatus'];
  }): void {
    this.systemInfo = {
      ssid: patch.ssid !== undefined ? patch.ssid : this.systemInfo.ssid,
      permissionStatus: patch.permissionStatus ?? this.systemInfo.permissionStatus,
      supportsPassphraseExtraction: false,
    };
  }

  public async saveWifi(
    ssid: string,
    password: string,
    userApproved = true,
  ): Promise<StoredWifiCredential> {
    return this.store.saveWifi(ssid, password, userApproved);
  }

  public async getWifi(ssid: string): Promise<string | undefined> {
    return this.store.getWifi(ssid);
  }

  public listWifiSsids(): readonly string[] {
    return this.store.listWifiSsids();
  }

  public removeWifi(ssid: string): boolean {
    return this.store.removeWifi(ssid);
  }

  public async saveThread(
    dataset: Uint8Array | number[] | string,
    meta: {
      source?: 'haus_otbr' | 'apple_threadnetwork' | 'android_thread' | 'manual';
      userApproved?: boolean;
    } = {},
  ): Promise<StoredThreadDataset> {
    return this.store.saveThreadDataset(dataset, {
      source: meta.source ?? 'manual',
      userApproved: meta.userApproved ?? true,
    });
  }

  public async getThread(extendedPanId?: string): Promise<Uint8Array | undefined> {
    return this.store.getThreadDataset(extendedPanId);
  }

  public listThreadNetworks(): readonly { networkName: string; extendedPanId: string }[] {
    return this.store.listThreadNetworks();
  }

  public setHausOtbrDatasetLoader(loader?: () => Promise<Uint8Array | undefined>): void {
    this.otbrLoader = loader;
    this.rebuildThreadManager();
  }

  public setSystemThreadProvider(provider?: SystemThreadProvider): void {
    this.systemProvider = provider;
    this.rebuildThreadManager();
  }

  public async resolveOperationalThreadDataset(): Promise<SystemThreadDatasetResult> {
    return this.threadManager.resolveOperationalDataset();
  }

  public clear(): void {
    this.store.clear();
  }

  private rebuildThreadManager(): void {
    this.threadManager = new SystemAssistedThreadManager(this.otbrLoader, this.systemProvider);
  }
}
