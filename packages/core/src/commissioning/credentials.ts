/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { NetworkCredentialProvider, WifiCredentials } from './types.js';
import { validateThreadDatasetTlv } from './thread-codec.js';

export type NetworkPermissionStatus = 'granted' | 'denied' | 'restricted' | 'unavailable';

export interface SystemNetworkInfo {
  readonly ssid?: string;
  readonly permissionStatus: NetworkPermissionStatus;
  /** Invariant: OS saved Wi-Fi passwords CANNOT be extracted without explicit user input. */
  readonly supportsPassphraseExtraction: false;
}

export interface StoredWifiCredential {
  readonly ssid: string;
  readonly encryptedPassword: string;
  readonly userApproved: boolean;
  readonly savedAt: string;
  readonly lastUsedAt: string;
}

export type SystemThreadAccessStatus =
  | 'granted'
  | 'denied'
  | 'missing_service'
  | 'unsupported'
  | 'keychain_error';

export interface SystemThreadDatasetResult {
  readonly status: SystemThreadAccessStatus;
  readonly dataset?: Uint8Array;
  readonly networkName?: string;
  readonly extendedPanId?: string;
  readonly channel?: number;
  readonly panId?: number;
  readonly error?: string;
}

export interface SystemThreadProvider {
  readonly platform: 'apple' | 'android' | 'otbr' | 'mock';
  getThreadDataset(): Promise<SystemThreadDatasetResult>;
}

export interface StoredThreadDataset {
  readonly networkName: string;
  readonly extendedPanId: string;
  readonly encryptedDataset: string;
  readonly source: 'haus_otbr' | 'apple_threadnetwork' | 'android_thread' | 'manual';
  readonly userApproved: boolean;
  readonly savedAt: string;
}

export interface CredentialCipher {
  encrypt(plaintext: Uint8Array): Promise<string>;
  decrypt(ciphertext: string): Promise<Uint8Array>;
}

/**
 * Redacts Wi-Fi credentials to prevent secret leakage in logs, events, and snapshots.
 */
export function redactWifiCredentials(
  creds?: WifiCredentials,
): { ssid: string; password: '***' } | undefined {
  if (!creds) return undefined;
  return { ssid: creds.ssid, password: '***' };
}

/**
 * Redacts Thread Active Operational Dataset to prevent key exposure in logs.
 */
export function redactThreadDataset(dataset?: Uint8Array | string): string | undefined {
  if (!dataset) return undefined;
  const len = dataset instanceof Uint8Array ? dataset.length : Math.floor(dataset.length / 2);
  return `[ThreadDataset: ${len} bytes, redacted]`;
}

/**
 * In-memory zeroing of sensitive buffers.
 */
export function wipeBuffer(buf?: Uint8Array | number[]): void {
  if (!buf) return;
  if (buf instanceof Uint8Array) {
    buf.fill(0);
  } else {
    for (let i = 0; i < buf.length; i++) {
      buf[i] = 0;
    }
  }
}

/**
 * Wipes password field of in-memory credential objects.
 */
export function wipeWifiCredentials(creds?: { ssid?: string; password?: string }): void {
  if (!creds) return;
  if (creds.password !== undefined) {
    creds.password = '';
  }
}

/**
 * Manual Wi-Fi credential provider offering explicit SSID/password entry on all platforms.
 * Prefills current SSID only when permission is granted by the underlying OS/platform.
 */
export class ManualWifiCredentialProvider implements NetworkCredentialProvider {
  private manualCredentials?: WifiCredentials;
  private manualThreadDataset?: Uint8Array;

  constructor(
    private readonly systemInfo: SystemNetworkInfo = {
      permissionStatus: 'unavailable',
      supportsPassphraseExtraction: false,
    },
  ) {}

  public async currentSsid(): Promise<string | undefined> {
    if (this.systemInfo.permissionStatus === 'granted') {
      return this.systemInfo.ssid;
    }
    return undefined;
  }

  public setManualCredentials(creds: WifiCredentials): void {
    this.manualCredentials = { ...creds };
  }

  public setManualThreadDataset(dataset: Uint8Array): void {
    this.manualThreadDataset = new Uint8Array(dataset);
  }

  public async wifiCredentials(): Promise<WifiCredentials | undefined> {
    return this.manualCredentials;
  }

  public async threadDataset(): Promise<Uint8Array | undefined> {
    return this.manualThreadDataset;
  }

  public wipe(): void {
    if (this.manualCredentials) {
      wipeWifiCredentials(this.manualCredentials);
      this.manualCredentials = undefined;
    }
    if (this.manualThreadDataset) {
      wipeBuffer(this.manualThreadDataset);
      this.manualThreadDataset = undefined;
    }
  }
}

/**
 * Encrypted network credential store.
 * Invariant: stores only user-approved reusable credentials in secure storage.
 */
export class EncryptedNetworkCredentialStore {
  private readonly wifiEntries = new Map<string, StoredWifiCredential>();
  private readonly threadEntries = new Map<string, StoredThreadDataset>();

  constructor(private readonly cipher: CredentialCipher) {}

  public async saveWifi(
    ssid: string,
    password: string,
    userApproved: boolean,
  ): Promise<StoredWifiCredential> {
    if (!userApproved) {
      throw new Error('user_approval_required: cannot store credentials without user consent');
    }
    const cleanSsid = ssid.trim();
    if (!cleanSsid) {
      throw new Error('invalid_ssid');
    }

    const encoder = new TextEncoder();
    const enc = await this.cipher.encrypt(encoder.encode(password));
    const now = new Date().toISOString();
    const entry: StoredWifiCredential = {
      ssid: cleanSsid,
      encryptedPassword: enc,
      userApproved: true,
      savedAt: now,
      lastUsedAt: now,
    };
    this.wifiEntries.set(cleanSsid, entry);
    return entry;
  }

  public async getWifi(ssid: string): Promise<string | undefined> {
    const entry = this.wifiEntries.get(ssid.trim());
    if (!entry) return undefined;
    const dec = await this.cipher.decrypt(entry.encryptedPassword);
    const decoder = new TextDecoder();
    return decoder.decode(dec);
  }

  public listWifiSsids(): readonly string[] {
    return Array.from(this.wifiEntries.keys());
  }

  public removeWifi(ssid: string): boolean {
    return this.wifiEntries.delete(ssid.trim());
  }

  public async saveThreadDataset(
    dataset: Uint8Array | number[] | string,
    meta: {
      source: 'haus_otbr' | 'apple_threadnetwork' | 'android_thread' | 'manual';
      userApproved: boolean;
    },
  ): Promise<StoredThreadDataset> {
    if (!meta.userApproved) {
      throw new Error('user_approval_required: cannot store Thread dataset without user consent');
    }
    const validation = validateThreadDatasetTlv(dataset);
    if (!validation.valid || !validation.dataset) {
      throw new Error(`invalid_thread_dataset: ${validation.errors.join(', ')}`);
    }

    const enc = await this.cipher.encrypt(validation.dataset.rawTlv);
    const now = new Date().toISOString();
    const entry: StoredThreadDataset = {
      networkName: validation.dataset.networkName,
      extendedPanId: validation.dataset.extendedPanId,
      encryptedDataset: enc,
      source: meta.source,
      userApproved: true,
      savedAt: now,
    };
    this.threadEntries.set(validation.dataset.extendedPanId, entry);
    return entry;
  }

  public async getThreadDataset(extendedPanId?: string): Promise<Uint8Array | undefined> {
    if (extendedPanId) {
      const entry = this.threadEntries.get(extendedPanId.toLowerCase());
      if (!entry) return undefined;
      return this.cipher.decrypt(entry.encryptedDataset);
    }
    const first = this.threadEntries.values().next().value as StoredThreadDataset | undefined;
    if (!first) return undefined;
    return this.cipher.decrypt(first.encryptedDataset);
  }

  public listThreadNetworks(): readonly { networkName: string; extendedPanId: string }[] {
    return Array.from(this.threadEntries.values()).map((e) => ({
      networkName: e.networkName,
      extendedPanId: e.extendedPanId,
    }));
  }

  public clear(): void {
    this.wifiEntries.clear();
    this.threadEntries.clear();
  }
}

/**
 * System-assisted Thread dataset manager.
 * Invariant: prefers an authorized Haus / OpenThread Border Router (OTBR) dataset.
 * Evaluates Apple ThreadNetwork and Android Thread Network APIs with permission/consent verification.
 */
export class SystemAssistedThreadManager {
  constructor(
    private readonly hausOtbrDataset?: () => Promise<Uint8Array | undefined>,
    private readonly systemProvider?: SystemThreadProvider,
  ) {}

  public async resolveOperationalDataset(): Promise<SystemThreadDatasetResult> {
    // 1. Prefer authorized Haus/OTBR dataset
    if (this.hausOtbrDataset) {
      const otbrTlv = await this.hausOtbrDataset();
      if (otbrTlv) {
        const val = validateThreadDatasetTlv(otbrTlv);
        if (val.valid && val.dataset) {
          return {
            status: 'granted',
            dataset: val.dataset.rawTlv,
            networkName: val.dataset.networkName,
            extendedPanId: val.dataset.extendedPanId,
            channel: val.dataset.channel,
            panId: val.dataset.panId,
          };
        }
      }
    }

    // 2. Fall back to optional system-assisted provider (Apple ThreadNetwork / Android)
    if (this.systemProvider) {
      const systemRes = await this.systemProvider.getThreadDataset();
      if (systemRes.status === 'granted' && systemRes.dataset) {
        const val = validateThreadDatasetTlv(systemRes.dataset);
        if (val.valid && val.dataset) {
          return {
            status: 'granted',
            dataset: val.dataset.rawTlv,
            networkName: val.dataset.networkName,
            extendedPanId: val.dataset.extendedPanId,
            channel: val.dataset.channel,
            panId: val.dataset.panId,
          };
        }
        return {
          status: 'keychain_error',
          error: 'System-provided Thread dataset was malformed or missing required TLVs',
        };
      }
      return systemRes;
    }

    return {
      status: 'unsupported',
      error: 'No Haus/OTBR or system Thread provider available; manual dataset entry required',
    };
  }
}
