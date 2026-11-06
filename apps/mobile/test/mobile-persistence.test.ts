/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { sanitizePreferences } from '@haus/ha/view/preferences';
import {
  MobilePersistence,
  type HaSession,
  type SecureKeyValueStore,
  type StringKeyValueStore,
} from '../src/storage/mobile-persistence';

class MemoryStore implements StringKeyValueStore {
  values = new Map<string, string>();
  failReads = false;
  getString(key: string) {
    if (this.failReads) throw new Error('corrupt');
    return this.values.get(key);
  }
  set(key: string, value: string) {
    this.values.set(key, value);
  }
  remove(key: string) {
    return this.values.delete(key);
  }
}

class SecureMemoryStore implements SecureKeyValueStore {
  values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async remove(key: string) {
    this.values.delete(key);
  }
}

const session: HaSession = {
  url: 'http://homeassistant.local:8123/',
  name: 'Home',
  clientId: 'haus-mobile-client',
  refreshToken: 'secret-refresh-token',
};

function snapshotDecoder(value: unknown): { deviceCount: number } | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'deviceCount' in value &&
    typeof value.deviceCount === 'number'
  )
    return { deviceCount: value.deviceCount };
}

function fixture() {
  const secureStore = new SecureMemoryStore();
  const cache = new MemoryStore();
  let now = 1_800_000_000_000;
  const storage = new MobilePersistence({
    secureStore,
    openEncryptedCache: () => cache,
    sha256: async (value) => fakeSha256(value),
    createEncryptionKey: async () => '0123456789abcdef0123456789abcdef',
    now: () => now,
  });
  return { storage, secureStore, cache, setNow: (value: number) => (now = value) };
}

function fakeSha256(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  return hash.toString(16).padStart(8, '0').repeat(8);
}

describe('mobile persistence', () => {
  it('restores the home layout beside its snapshot and clears both only for the signed-out session', async () => {
    const { storage, cache } = fixture();
    const otherSession = { ...session, refreshToken: 'other-account-token' };
    const preferences = sanitizePreferences({
      hiddenHome: ['light.kitchen'],
      deviceOrder: { 'home:room:kitchen': ['device:lamp'] },
    });
    await storage.saveSession(session);
    await storage.saveHomePreferences(session, preferences);
    await storage.saveHomeSnapshot(session, { deviceCount: 3 });
    await storage.saveHomePreferences(
      otherSession,
      sanitizePreferences({ favorites: ['light.other'] }),
    );
    expect(await storage.loadHomePreferences(session)).toEqual(preferences);
    expect(
      await storage.loadHomePreferences({ ...session, refreshToken: 'unknown-session' }),
    ).toBeNull();
    expect([...cache.values.values()].join()).not.toContain(session.refreshToken);
    await storage.clearSession();
    expect(await storage.loadHomePreferences(session)).toBeNull();
    expect(cache.values.size).toBe(1);
    expect((await storage.loadHomePreferences(otherSession))?.favorites).toEqual(['light.other']);
  });
  it('stores HA credentials only in secure storage and scopes snapshots to the session', async () => {
    const { storage, secureStore, cache } = fixture();
    await storage.saveSession(session);
    await storage.saveHomeSnapshot(session, { deviceCount: 8 });

    expect(await storage.loadSession()).toEqual({
      ...session,
      url: 'http://homeassistant.local:8123',
    });
    expect([...secureStore.values.keys()]).toEqual([
      'haus.mobile.session.v1',
      'haus.mobile.cache-key.v1',
    ]);
    expect([...cache.values.keys()][0]).toMatch(/^home\.snapshot\.v1\.[a-f0-9]{64}$/);
    expect([...cache.values.values()][0]).not.toContain(session.refreshToken);
    expect(await storage.loadHomeSnapshot(session, snapshotDecoder)).toMatchObject({
      snapshot: { deviceCount: 8 },
    });

    const otherSession = { ...session, refreshToken: 'other-account-token' };
    expect(await storage.loadHomeSnapshot(otherSession, snapshotDecoder)).toBeNull();
  });

  it('normalizes base URLs and rejects credentials embedded in the URL', async () => {
    const { storage } = fixture();
    await storage.saveSession(session);
    expect((await storage.loadSession())?.url).toBe('http://homeassistant.local:8123');
    await expect(
      storage.saveSession({ ...session, url: 'http://user:password@ha.local:8123' }),
    ).rejects.toThrow('Invalid Home Assistant session');
  });

  it('recovers from malformed, stale and unreadable cache entries', async () => {
    const { storage, cache, setNow } = fixture();
    await storage.saveHomeSnapshot(session, { deviceCount: 4 });
    const key = [...cache.values.keys()][0]!;
    cache.values.set(key, '{broken');
    expect(await storage.loadHomeSnapshot(session, snapshotDecoder)).toBeNull();
    expect(cache.values.has(key)).toBe(false);

    await storage.saveHomeSnapshot(session, { deviceCount: 4 });
    setNow(1_800_700_000_000);
    expect(await storage.loadHomeSnapshot(session, snapshotDecoder)).toBeNull();
    expect(cache.values.has(key)).toBe(false);

    await storage.saveHomeSnapshot(session, { deviceCount: 4 });
    cache.failReads = true;
    expect(await storage.loadHomeSnapshot(session, snapshotDecoder)).toBeNull();
    expect(cache.values.has(key)).toBe(false);
  });

  it('migrates the exact legacy cache envelope into the versioned format', async () => {
    const { storage, cache, setNow } = fixture();
    await storage.saveHomeSnapshot(session, { deviceCount: 5 });
    const key = [...cache.values.keys()][0]!;
    const current = JSON.parse(cache.values.get(key)!);
    cache.values.set(
      key,
      JSON.stringify({
        scope: current.scope,
        capturedAt: current.capturedAt,
        snapshot: current.snapshot,
      }),
    );
    setNow(current.capturedAt);

    expect(await storage.loadHomeSnapshot(session, snapshotDecoder)).toMatchObject({
      snapshot: { deviceCount: 5 },
    });
    expect(JSON.parse(cache.values.get(key)!)).toMatchObject({
      schema: 'haus.snapshot',
      version: 1,
    });
  });

  it('clears the active session and only its home snapshot on logout', async () => {
    const { storage, secureStore, cache } = fixture();
    const otherSession = { ...session, refreshToken: 'other-account-token' };
    await storage.saveSession(session);
    await storage.saveHomeSnapshot(session, { deviceCount: 1 });
    await storage.saveHomeSnapshot(otherSession, { deviceCount: 2 });

    await storage.clearSession();

    expect(await storage.loadSession()).toBeNull();
    expect(secureStore.values.has('haus.mobile.session.v1')).toBe(false);
    expect(cache.values.size).toBe(1);
    expect(await storage.loadHomeSnapshot(otherSession, snapshotDecoder)).toMatchObject({
      snapshot: { deviceCount: 2 },
    });
  });

  it('invalidates a pending snapshot save when the user signs out', async () => {
    const secureStore = new SecureMemoryStore();
    const cache = new MemoryStore();
    let releaseOpen!: (value: StringKeyValueStore) => void;
    const cachePromise = new Promise<StringKeyValueStore>((resolve) => {
      releaseOpen = resolve;
    });
    const openEncryptedCache = () => cachePromise;
    const storage = new MobilePersistence({
      secureStore,
      openEncryptedCache,
      sha256: async (value) => fakeSha256(value),
      createEncryptionKey: async () => '0123456789abcdef0123456789abcdef',
    });
    await storage.saveSession(session);
    const pendingSave = storage.saveHomeSnapshot(session, { deviceCount: 3 });
    const logout = storage.clearSession();
    releaseOpen(cache);
    await Promise.all([pendingSave, logout]);

    expect(cache.values.size).toBe(0);
  });
});
