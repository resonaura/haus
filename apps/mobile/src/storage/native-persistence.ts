/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createMMKV } from 'react-native-mmkv';
import { MobilePersistence } from './mobile-persistence';

const keychainOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function base64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    encoded += second === undefined ? '=' : alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    encoded += third === undefined ? '=' : alphabet[third & 0x3f];
  }
  return encoded;
}

/** A 24-byte cryptographic random value encoded as exactly 32 UTF-8 bytes for MMKV AES-256. */
async function createCacheEncryptionKey(): Promise<string> {
  return base64(await Crypto.getRandomBytesAsync(24));
}

export const mobilePersistence = new MobilePersistence({
  secureStore: {
    get: (key) => SecureStore.getItemAsync(key, keychainOptions),
    set: (key, value) => SecureStore.setItemAsync(key, value, keychainOptions),
    remove: (key) => SecureStore.deleteItemAsync(key, keychainOptions),
  },
  openEncryptedCache: (encryptionKey) =>
    createMMKV({
      id: 'haus-home-snapshots-v1',
      encryptionKey,
      encryptionType: 'AES-256',
      recoveryStrategy: 'recover-on-error',
      compareBeforeSet: true,
    }),
  sha256: (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  createEncryptionKey: createCacheEncryptionKey,
});
