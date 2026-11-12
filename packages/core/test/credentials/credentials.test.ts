/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  type CredentialCipher,
  EncryptedNetworkCredentialStore,
  ManualWifiCredentialProvider,
  SystemAssistedThreadManager,
  type SystemNetworkInfo,
  type SystemThreadProvider,
  encodeThreadDatasetTlv,
  redactThreadDataset,
  redactWifiCredentials,
  validateThreadDatasetTlv,
  wipeBuffer,
  wipeWifiCredentials,
} from '../../src/commissioning/index.js';

class MockCipher implements CredentialCipher {
  public async encrypt(plaintext: Uint8Array): Promise<string> {
    return `enc:${Buffer.from(plaintext).toString('hex')}`;
  }

  public async decrypt(ciphertext: string): Promise<Uint8Array> {
    if (!ciphertext.startsWith('enc:')) {
      throw new Error('invalid_ciphertext');
    }
    return new Uint8Array(Buffer.from(ciphertext.slice(4), 'hex'));
  }
}

describe('Thread Dataset Codec', () => {
  const sampleFields = {
    networkName: 'HausThread',
    channel: 15,
    panId: 0x1234,
    extendedPanId: '1122334455667788',
    networkKey: '00112233445566778899aabbccddeeff',
  };

  it('encodes and validates valid Thread Active Operational Dataset TLV', () => {
    const encoded = encodeThreadDatasetTlv(sampleFields);
    expect(encoded.length).toBeGreaterThan(20);

    const validation = validateThreadDatasetTlv(encoded);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(validation.dataset).toBeDefined();
    expect(validation.dataset?.networkName).toBe('HausThread');
    expect(validation.dataset?.channel).toBe(15);
    expect(validation.dataset?.panId).toBe(0x1234);
    expect(validation.dataset?.extendedPanId).toBe('1122334455667788');
    expect(validation.dataset?.networkKey).toBe('00112233445566778899aabbccddeeff');
  });

  it('parses valid Thread dataset from hex string', () => {
    const encoded = encodeThreadDatasetTlv(sampleFields);
    const hex = Buffer.from(encoded).toString('hex');

    const validation = validateThreadDatasetTlv(`0x${hex}`);
    expect(validation.valid).toBe(true);
    expect(validation.dataset?.networkName).toBe('HausThread');
    expect(validation.dataset?.channel).toBe(15);
  });

  it('rejects invalid hex strings', () => {
    const res1 = validateThreadDatasetTlv('not-a-hex');
    expect(res1.valid).toBe(false);
    expect(res1.errors).toContain('Invalid hex string for Thread dataset');

    const res2 = validateThreadDatasetTlv('0x123'); // odd length
    expect(res2.valid).toBe(false);
  });

  it('rejects truncated or too-short dataset buffers', () => {
    const tooShort = new Uint8Array([0x00, 0x01, 0x00]);
    const res = validateThreadDatasetTlv(tooShort);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Thread dataset TLV too short');
  });

  it('rejects out-of-range Thread channels (< 11 or > 26)', () => {
    const lowChannel = encodeThreadDatasetTlv({ ...sampleFields, channel: 10 });
    const lowRes = validateThreadDatasetTlv(lowChannel);
    expect(lowRes.valid).toBe(false);
    expect(lowRes.errors.some((e) => e.includes('between 11 and 26'))).toBe(true);

    const highChannel = encodeThreadDatasetTlv({ ...sampleFields, channel: 27 });
    const highRes = validateThreadDatasetTlv(highChannel);
    expect(highRes.valid).toBe(false);
    expect(highRes.errors.some((e) => e.includes('between 11 and 26'))).toBe(true);
  });

  it('detects missing required TLVs', () => {
    // Only Channel TLV, missing network name, PAN ID, extended PAN ID, network key
    const raw = new Uint8Array([
      0x00, 0x03, 0x00, 0x00, 0x0f, // Channel 15
      0x07, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, // Mesh local prefix
    ]);
    const res = validateThreadDatasetTlv(raw);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Missing Network Name in Thread dataset');
    expect(res.errors).toContain('Missing PAN ID in Thread dataset');
    expect(res.errors).toContain('Missing Extended PAN ID in Thread dataset');
    expect(res.errors).toContain('Missing Network Key in Thread dataset');
  });

  it('detects truncated TLV value', () => {
    // Network name (6 bytes) + PAN ID (tag 0x01, declared length 10, but buffer ends after 4 bytes)
    const truncated = new Uint8Array([
      0x03, 0x04, 0x4d, 0x65, 0x73, 0x68,
      0x01, 0x0a, 0x12, 0x34, 0x56, 0x78,
    ]);
    const res = validateThreadDatasetTlv(truncated);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Truncated TLV value for tag 0x01'))).toBe(true);
  });
});

describe('Manual Wi-Fi Credential Provider', () => {
  it('prefills current SSID only when permission is granted', async () => {
    const grantedInfo: SystemNetworkInfo = {
      ssid: 'Haus-Secure-5G',
      permissionStatus: 'granted',
      supportsPassphraseExtraction: false,
    };
    const provider = new ManualWifiCredentialProvider(grantedInfo);
    expect(await provider.currentSsid()).toBe('Haus-Secure-5G');
  });

  it('returns undefined SSID when permission is denied or unavailable', async () => {
    const deniedInfo: SystemNetworkInfo = {
      ssid: 'Haus-Secure-5G',
      permissionStatus: 'denied',
      supportsPassphraseExtraction: false,
    };
    const deniedProvider = new ManualWifiCredentialProvider(deniedInfo);
    expect(await deniedProvider.currentSsid()).toBeUndefined();

    const unavailProvider = new ManualWifiCredentialProvider();
    expect(await unavailProvider.currentSsid()).toBeUndefined();
  });

  it('supports explicit manual SSID and password entry', async () => {
    const provider = new ManualWifiCredentialProvider();
    expect(await provider.wifiCredentials()).toBeUndefined();

    provider.setManualCredentials({ ssid: 'GuestWifi', password: 'secretpassword123' });
    const creds = await provider.wifiCredentials();
    expect(creds).toEqual({ ssid: 'GuestWifi', password: 'secretpassword123' });
  });

  it('supports manual Thread dataset entry', async () => {
    const provider = new ManualWifiCredentialProvider();
    expect(await provider.threadDataset()).toBeUndefined();

    const dataset = new Uint8Array([1, 2, 3, 4]);
    provider.setManualThreadDataset(dataset);
    const retrieved = await provider.threadDataset();
    expect(retrieved).toEqual(dataset);
  });

  it('wipes temporary credentials from memory on wipe()', async () => {
    const provider = new ManualWifiCredentialProvider();
    provider.setManualCredentials({ ssid: 'SecretSsid', password: 'ClearPassword' });
    provider.setManualThreadDataset(new Uint8Array([10, 20, 30]));

    provider.wipe();
    expect(await provider.wifiCredentials()).toBeUndefined();
    expect(await provider.threadDataset()).toBeUndefined();
  });
});

describe('Encrypted Network Credential Store', () => {
  it('requires explicit user approval before saving Wi-Fi credentials', async () => {
    const cipher = new MockCipher();
    const store = new EncryptedNetworkCredentialStore(cipher);

    await expect(store.saveWifi('HomeNet', 'secretPass', false)).rejects.toThrow(
      'user_approval_required',
    );
  });

  it('rejects empty or whitespace-only SSID', async () => {
    const cipher = new MockCipher();
    const store = new EncryptedNetworkCredentialStore(cipher);

    await expect(store.saveWifi('   ', 'secretPass', true)).rejects.toThrow('invalid_ssid');
  });

  it('saves and retrieves user-approved Wi-Fi credentials', async () => {
    const cipher = new MockCipher();
    const store = new EncryptedNetworkCredentialStore(cipher);

    const saved = await store.saveWifi('HomeNet', 'secretPass123', true);
    expect(saved.ssid).toBe('HomeNet');
    expect(saved.userApproved).toBe(true);
    expect(saved.encryptedPassword).toContain('enc:');

    const retrieved = await store.getWifi('HomeNet');
    expect(retrieved).toBe('secretPass123');

    const nonExistent = await store.getWifi('UnknownNet');
    expect(nonExistent).toBeUndefined();

    expect(store.listWifiSsids()).toEqual(['HomeNet']);

    expect(store.removeWifi('HomeNet')).toBe(true);
    expect(store.listWifiSsids()).toHaveLength(0);
  });

  it('requires explicit user approval and valid TLV for Thread dataset', async () => {
    const cipher = new MockCipher();
    const store = new EncryptedNetworkCredentialStore(cipher);

    const validTlv = encodeThreadDatasetTlv({
      networkName: 'HausMesh',
      channel: 20,
      panId: 0x4321,
      extendedPanId: 'aabbccddeeff0011',
      networkKey: '0102030405060708090a0b0c0d0e0f10',
    });

    await expect(
      store.saveThreadDataset(validTlv, { source: 'haus_otbr', userApproved: false }),
    ).rejects.toThrow('user_approval_required');

    await expect(
      store.saveThreadDataset(new Uint8Array([0, 1, 2]), {
        source: 'haus_otbr',
        userApproved: true,
      }),
    ).rejects.toThrow('invalid_thread_dataset');

    const saved = await store.saveThreadDataset(validTlv, {
      source: 'haus_otbr',
      userApproved: true,
    });
    expect(saved.networkName).toBe('HausMesh');
    expect(saved.extendedPanId).toBe('aabbccddeeff0011');
    expect(saved.userApproved).toBe(true);

    const retrieved = await store.getThreadDataset('aabbccddeeff0011');
    expect(retrieved).toEqual(validTlv);

    const list = store.listThreadNetworks();
    expect(list).toEqual([{ networkName: 'HausMesh', extendedPanId: 'aabbccddeeff0011' }]);

    store.clear();
    expect(store.listThreadNetworks()).toHaveLength(0);
    expect(store.listWifiSsids()).toHaveLength(0);
  });
});

describe('System-Assisted Thread Manager', () => {
  const sampleTlv = encodeThreadDatasetTlv({
    networkName: 'OtbrMesh',
    channel: 25,
    panId: 0x9876,
    extendedPanId: '1234567890abcdef',
    networkKey: '11223344556677889900aabbccddeeff',
  });

  it('prefers Haus/OTBR dataset when available', async () => {
    const manager = new SystemAssistedThreadManager(async () => sampleTlv);
    const res = await manager.resolveOperationalDataset();
    expect(res.status).toBe('granted');
    expect(res.networkName).toBe('OtbrMesh');
    expect(res.channel).toBe(25);
    expect(res.panId).toBe(0x9876);
  });

  it('falls back to SystemThreadProvider when OTBR dataset is unavailable', async () => {
    const mockSystemProvider: SystemThreadProvider = {
      platform: 'apple',
      getThreadDataset: async () => ({
        status: 'granted',
        dataset: sampleTlv,
      }),
    };

    const manager = new SystemAssistedThreadManager(
      async () => undefined,
      mockSystemProvider,
    );
    const res = await manager.resolveOperationalDataset();
    expect(res.status).toBe('granted');
    expect(res.networkName).toBe('OtbrMesh');
  });

  it('propagates denied status from system provider', async () => {
    const mockSystemProvider: SystemThreadProvider = {
      platform: 'android',
      getThreadDataset: async () => ({
        status: 'denied',
        error: 'User rejected permission to share Thread network credentials',
      }),
    };

    const manager = new SystemAssistedThreadManager(
      async () => undefined,
      mockSystemProvider,
    );
    const res = await manager.resolveOperationalDataset();
    expect(res.status).toBe('denied');
    expect(res.error).toContain('User rejected');
  });

  it('flags keychain_error if system returns invalid dataset TLV', async () => {
    const mockSystemProvider: SystemThreadProvider = {
      platform: 'apple',
      getThreadDataset: async () => ({
        status: 'granted',
        dataset: new Uint8Array([1, 2, 3]), // Invalid TLV
      }),
    };

    const manager = new SystemAssistedThreadManager(
      async () => undefined,
      mockSystemProvider,
    );
    const res = await manager.resolveOperationalDataset();
    expect(res.status).toBe('keychain_error');
    expect(res.error).toContain('malformed');
  });

  it('returns unsupported when neither OTBR nor system provider is available', async () => {
    const manager = new SystemAssistedThreadManager();
    const res = await manager.resolveOperationalDataset();
    expect(res.status).toBe('unsupported');
  });
});

describe('Credential Redaction and Buffer Zeroing', () => {
  it('redacts Wi-Fi password without altering SSID', () => {
    expect(redactWifiCredentials(undefined)).toBeUndefined();
    const redacted = redactWifiCredentials({ ssid: 'MyLan', password: 'VerySecretPassword!' });
    expect(redacted).toEqual({ ssid: 'MyLan', password: '***' });
  });

  it('redacts Thread dataset without leaking keys', () => {
    expect(redactThreadDataset(undefined)).toBeUndefined();
    const tlv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const redacted = redactThreadDataset(tlv);
    expect(redacted).toBe('[ThreadDataset: 10 bytes, redacted]');
  });

  it('wipes buffers in memory', () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    wipeBuffer(buf);
    expect(buf).toEqual(new Uint8Array([0, 0, 0, 0]));

    const arr = [5, 6, 7];
    wipeBuffer(arr);
    expect(arr).toEqual([0, 0, 0]);
  });

  it('wipes Wi-Fi credential object in memory', () => {
    const creds = { ssid: 'HausNet', password: 'MyPassword' };
    wipeWifiCredentials(creds);
    expect(creds.password).toBe('');
  });
});
