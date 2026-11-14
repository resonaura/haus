/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
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
import { HUB_DATA_DIRECTORY, resolveOrProvisionMasterKey } from '../cluster/crypto/master-key.js';
import { StandaloneHomePersistence } from '../home/home.persistence.js';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';

/**
 * AES-256-GCM cipher for encrypting stored network secrets in Hub local storage.
 * Output format: ivHex:authTagHex:ciphertextHex
 */
export class AesGcmCredentialCipher implements CredentialCipher {
  private readonly key: Buffer;

  constructor(keyMaterial?: Buffer | string, options?: { readonly dataDir?: string }) {
    if (keyMaterial) {
      if (typeof keyMaterial === 'string') {
        this.key = createHash('sha256').update(keyMaterial).digest();
      } else if (keyMaterial.length === 32) {
        this.key = keyMaterial;
      } else {
        this.key = createHash('sha256').update(keyMaterial).digest();
      }
    } else if (process.env.HAUS_CREDENTIAL_KEY?.trim()) {
      this.key = createHash('sha256').update(process.env.HAUS_CREDENTIAL_KEY.trim()).digest();
    } else {
      this.key = resolveOrProvisionMasterKey({ dataDir: options?.dataDir });
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
export class HubNetworkCredentialService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HubNetworkCredentialService.name);
  private readonly cipher: AesGcmCredentialCipher;
  private readonly store: EncryptedNetworkCredentialStore;
  private readonly persistence: StandaloneHomePersistence;
  private readonly syncListeners = new Set<(resourceId: string) => void>();
  private threadManager: SystemAssistedThreadManager;
  private systemInfo: SystemNetworkInfo = {
    permissionStatus: 'unavailable',
    supportsPassphraseExtraction: false,
  };
  private otbrLoader?: () => Promise<Uint8Array | undefined>;
  private systemProvider?: SystemThreadProvider;

  constructor(
    @Optional() @Inject(HUB_DATA_DIRECTORY) dataDir?: string,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
  ) {
    this.cipher = new AesGcmCredentialCipher(undefined, { dataDir });
    this.store = new EncryptedNetworkCredentialStore(this.cipher);
    this.persistence = new StandaloneHomePersistence(transactions);
    this.threadManager = new SystemAssistedThreadManager();
  }

  async onModuleInit(): Promise<void> {
    const rows = await this.persistence.listByKind<{ readonly encrypted: string }>(
      'network_credentials',
    );
    for (const row of rows) {
      if (!row.value?.encrypted) continue;
      try {
        const plain = Buffer.from(await this.cipher.decrypt(row.value.encrypted)).toString('utf8');
        const parsed = JSON.parse(plain) as
          | { kind: 'wifi'; ssid: string; password: string; userApproved?: boolean }
          | {
              kind: 'thread';
              datasetHex: string;
              source?: 'haus_otbr' | 'apple_threadnetwork' | 'android_thread' | 'manual';
              userApproved?: boolean;
            };
        if (parsed.kind === 'wifi' && parsed.ssid && parsed.password) {
          await this.store.saveWifi(parsed.ssid, parsed.password, parsed.userApproved ?? true);
        } else if (parsed.kind === 'thread' && parsed.datasetHex) {
          await this.store.saveThreadDataset(Buffer.from(parsed.datasetHex, 'hex'), {
            source: parsed.source ?? 'manual',
            userApproved: parsed.userApproved ?? true,
          });
        }
      } catch {
        this.logger.warn(`Failed to restore persisted network credential ${row.entryId}`);
      }
    }
  }

  onModuleDestroy(): void {
    this.persistence.close();
    this.syncListeners.clear();
  }

  onCredentialChange(listener: (resourceId: string) => void): () => void {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  private emitChange(resourceId: string): void {
    for (const listener of this.syncListeners) {
      try {
        listener(resourceId);
      } catch {
        // Sync listeners must not break credential storage.
      }
    }
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
    const saved = await this.store.saveWifi(ssid, password, userApproved);
    const encrypted = await this.cipher.encrypt(
      Buffer.from(JSON.stringify({ kind: 'wifi', ssid, password, userApproved }), 'utf8'),
    );
    await this.persistence.save('network_credentials', `wifi:${ssid}`, { encrypted });
    this.emitChange(`wifi:${ssid}`);
    return saved;
  }

  public async getWifi(ssid: string): Promise<string | undefined> {
    return this.store.getWifi(ssid);
  }

  public listWifiSsids(): readonly string[] {
    return this.store.listWifiSsids();
  }

  public removeWifi(ssid: string): boolean {
    const removed = this.store.removeWifi(ssid);
    if (removed) {
      void this.persistence.remove('network_credentials', `wifi:${ssid}`);
      this.emitChange(`wifi:${ssid}`);
    }
    return removed;
  }

  public async saveThread(
    dataset: Uint8Array | number[] | string,
    meta: {
      source?: 'haus_otbr' | 'apple_threadnetwork' | 'android_thread' | 'manual';
      userApproved?: boolean;
    } = {},
  ): Promise<StoredThreadDataset> {
    const source = meta.source ?? 'manual';
    const userApproved = meta.userApproved ?? true;
    const saved = await this.store.saveThreadDataset(dataset, {
      source,
      userApproved,
    });
    const rawDataset = await this.store.getThreadDataset(saved.extendedPanId);
    if (rawDataset) {
      const encrypted = await this.cipher.encrypt(
        Buffer.from(
          JSON.stringify({
            kind: 'thread',
            datasetHex: Buffer.from(rawDataset).toString('hex'),
            source,
            userApproved,
          }),
          'utf8',
        ),
      );
      await this.persistence.save('network_credentials', `thread:${saved.extendedPanId}`, {
        encrypted,
      });
      this.emitChange(`thread:${saved.extendedPanId}`);
    }
    return saved;
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
