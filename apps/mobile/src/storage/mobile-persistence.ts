/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  createSnapshotEnvelope,
  parseSnapshotEnvelope,
  snapshotEnvelopeSchema,
  snapshotEnvelopeVersion,
} from '@haus/core/snapshot-envelope';
import { validateSessionCredentials, type ClientSessionCredentials } from '@haus/core/auth';
import { sanitizePreferences, type Preferences } from '@haus/ha/view/preferences';

export interface HaSession {
  url: string;
  name: string;
  clientId: string;
  refreshToken: string;
}

export interface StringKeyValueStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
}

export interface SecureKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface MobilePersistenceDependencies {
  secureStore: SecureKeyValueStore;
  openEncryptedCache(encryptionKey: string): StringKeyValueStore | Promise<StringKeyValueStore>;
  sha256(value: string): Promise<string>;
  createEncryptionKey(): Promise<string>;
  now?: () => number;
}

const SESSION_KEY = 'haus.mobile.session.v1';
const HUB_SESSION_KEY = 'haus.mobile.hub-session.v1';
const CACHE_ENCRYPTION_KEY = 'haus.mobile.cache-key.v1';
const CACHE_KEY_PREFIX = 'home.snapshot.v1.';
const LAYOUT_KEY_PREFIX = 'home.layout.v1.';
const SESSION_MAX_BYTES = 1_800;
const SNAPSHOT_MAX_CHARACTERS = 6_000_000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export function normalizeHaBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TypeError('Enter a valid Home Assistant URL.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new TypeError('Home Assistant URL must be an HTTP(S) base URL without credentials.');

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function parseSession(value: unknown): HaSession | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('url' in value) ||
    !('name' in value) ||
    !('clientId' in value) ||
    !('refreshToken' in value)
  )
    return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.url !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.clientId !== 'string' ||
    typeof candidate.refreshToken !== 'string' ||
    !candidate.name.trim() ||
    !candidate.clientId.trim() ||
    !candidate.refreshToken
  )
    return null;
  try {
    return {
      url: normalizeHaBaseUrl(candidate.url),
      name: candidate.name.trim(),
      clientId: candidate.clientId,
      refreshToken: candidate.refreshToken,
    };
  } catch {
    return null;
  }
}

function isExactLegacyEnvelope(value: unknown): value is {
  scope: string;
  capturedAt: number;
  snapshot: unknown;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => ['scope', 'capturedAt', 'snapshot'].includes(key)) &&
    Object.keys(record).length === 3 &&
    typeof record.scope === 'string' &&
    Number.isSafeInteger(record.capturedAt) &&
    'snapshot' in record
  );
}

/** Secure session and versioned, encrypted, session-scoped mobile home snapshots. */
export class MobilePersistence {
  private cache?: Promise<StringKeyValueStore>;
  private sessionWrite: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(private readonly dependencies: MobilePersistenceDependencies) {}

  async loadSession(): Promise<HaSession | null> {
    const raw = await this.dependencies.secureStore.get(SESSION_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      void this.clearInvalidSession().catch(() => undefined);
      return null;
    }
    const session = parseSession(parsed);
    if (!session) void this.clearInvalidSession().catch(() => undefined);
    return session;
  }

  saveSession(value: HaSession): Promise<void> {
    const session = parseSession(value);
    if (!session) return Promise.reject(new TypeError('Invalid Home Assistant session.'));
    const text = JSON.stringify(session);
    if (utf8ByteLength(text) > SESSION_MAX_BYTES)
      return Promise.reject(new Error('Saved session is too large for secure device storage.'));

    const write = this.sessionWrite
      .catch(() => undefined)
      .then(async () => {
        await this.dependencies.secureStore.set(SESSION_KEY, text);
        ++this.generation;
      });
    this.sessionWrite = write;
    return write;
  }

  /** Sign-out invalidates pending snapshot writes and removes only this HA session's cache. */
  clearSession(): Promise<void> {
    const write = this.sessionWrite
      .catch(() => undefined)
      .then(async () => {
        const previous = await this.loadSession();
        const generation = ++this.generation;
        await this.dependencies.secureStore.remove(SESSION_KEY);
        if (!previous) return;
        const scope = await this.scopeFor(previous);
        const store = await this.openCache();
        if (generation === this.generation) {
          store.remove(`${CACHE_KEY_PREFIX}${scope}`);
          store.remove(`${LAYOUT_KEY_PREFIX}${scope}`);
        }
      });
    this.sessionWrite = write;
    return write;
  }

  async loadHubSession(): Promise<ClientSessionCredentials | null> {
    const raw = await this.dependencies.secureStore.get(HUB_SESSION_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.dependencies.secureStore.remove(HUB_SESSION_KEY).catch(() => undefined);
      return null;
    }
    const validated = validateSessionCredentials(parsed);
    if (!validated) {
      await this.dependencies.secureStore.remove(HUB_SESSION_KEY).catch(() => undefined);
      return null;
    }
    return validated;
  }

  saveHubSession(value: ClientSessionCredentials): Promise<void> {
    const validated = validateSessionCredentials(value);
    if (!validated) return Promise.reject(new TypeError('Invalid Hub session.'));
    const text = JSON.stringify(validated);
    if (utf8ByteLength(text) > SESSION_MAX_BYTES)
      return Promise.reject(new Error('Saved session is too large for secure device storage.'));

    const write = this.sessionWrite
      .catch(() => undefined)
      .then(async () => {
        await this.dependencies.secureStore.set(HUB_SESSION_KEY, text);
        ++this.generation;
      });
    this.sessionWrite = write;
    return write;
  }

  clearHubSession(): Promise<void> {
    const write = this.sessionWrite
      .catch(() => undefined)
      .then(async () => {
        await this.dependencies.secureStore.remove(HUB_SESSION_KEY);
        ++this.generation;
      });
    this.sessionWrite = write;
    return write;
  }

  async saveHomeSnapshot<T>(sessionValue: HaSession, snapshot: T): Promise<void> {
    const session = parseSession(sessionValue);
    if (!session) throw new TypeError('Invalid Home Assistant session.');
    const generation = this.generation;
    const scope = await this.scopeFor(session);
    const envelope = createSnapshotEnvelope(scope, this.now(), snapshot);
    const text = JSON.stringify(envelope);
    if (text.length > SNAPSHOT_MAX_CHARACTERS) throw new Error('Home snapshot is too large.');
    const store = await this.openCache();
    if (generation !== this.generation) return;
    // One synchronous MMKV value replacement prevents readers from observing a partial JSON write.
    store.set(`${CACHE_KEY_PREFIX}${scope}`, text);
  }

  async saveHomePreferences(sessionValue: HaSession, preferences: Preferences): Promise<void> {
    const session = parseSession(sessionValue);
    if (!session) throw new TypeError('Invalid Home Assistant session.');
    const generation = this.generation;
    const scope = await this.scopeFor(session);
    const text = JSON.stringify(
      createSnapshotEnvelope(scope, this.now(), sanitizePreferences(preferences)),
    );
    if (text.length > 1_000_000) throw new Error('Home layout is too large.');
    const store = await this.openCache();
    if (generation === this.generation) store.set(`${LAYOUT_KEY_PREFIX}${scope}`, text);
  }

  async loadHomePreferences(sessionValue: HaSession): Promise<Preferences | null> {
    const session = parseSession(sessionValue);
    if (!session) return null;
    const generation = this.generation;
    const scope = await this.scopeFor(session);
    const store = await this.openCache();
    if (generation !== this.generation) return null;
    const key = `${LAYOUT_KEY_PREFIX}${scope}`;
    try {
      const text = store.getString(key);
      if (!text) return null;
      if (text.length > 1_000_000) throw new Error('oversized-layout');
      const envelope = parseSnapshotEnvelope(JSON.parse(text), {
        scope,
        now: this.now(),
        maxAgeMs: DEFAULT_MAX_AGE_MS,
        decode: (value: unknown) =>
          typeof value === 'object' && value !== null && !Array.isArray(value)
            ? sanitizePreferences(value)
            : undefined,
      });
      if (!envelope) this.removeCorruptCacheEntry(store, key);
      return generation === this.generation ? (envelope?.snapshot ?? null) : null;
    } catch {
      this.removeCorruptCacheEntry(store, key);
      return null;
    }
  }

  async loadHomeSnapshot<T>(
    sessionValue: HaSession,
    decode: (value: unknown) => T | undefined,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
  ): Promise<{ capturedAt: number; snapshot: T } | null> {
    const session = parseSession(sessionValue);
    if (!session || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) return null;
    const generation = this.generation;
    const scope = await this.scopeFor(session);
    const key = `${CACHE_KEY_PREFIX}${scope}`;
    const store = await this.openCache();
    if (generation !== this.generation) return null;

    let value: unknown;
    try {
      const text = store.getString(key);
      if (!text) return null;
      if (text.length > SNAPSHOT_MAX_CHARACTERS) throw new Error('oversized-cache');
      value = JSON.parse(text);
    } catch {
      this.removeCorruptCacheEntry(store, key);
      return null;
    }

    const options = { scope, now: this.now(), maxAgeMs, decode };
    let envelope = parseSnapshotEnvelope(value, options);
    if (!envelope && isExactLegacyEnvelope(value)) {
      envelope = parseSnapshotEnvelope(
        {
          schema: snapshotEnvelopeSchema,
          version: snapshotEnvelopeVersion,
          scope: value.scope,
          capturedAt: value.capturedAt,
          snapshot: value.snapshot,
        },
        options,
      );
      if (envelope && generation === this.generation) {
        try {
          store.set(key, JSON.stringify(envelope));
        } catch {
          // A readable legacy cache remains usable even if its best-effort migration cannot write.
        }
      }
    }
    if (!envelope) {
      this.removeCorruptCacheEntry(store, key);
      return null;
    }
    if (generation !== this.generation) return null;
    return { capturedAt: envelope.capturedAt, snapshot: envelope.snapshot };
  }

  private async scopeFor(session: HaSession): Promise<string> {
    return this.dependencies.sha256(
      JSON.stringify([session.url, session.clientId, session.refreshToken]),
    );
  }

  private openCache(): Promise<StringKeyValueStore> {
    if (!this.cache) {
      this.cache = (async () => {
        let encryptionKey = await this.dependencies.secureStore.get(CACHE_ENCRYPTION_KEY);
        if (encryptionKey === null || utf8ByteLength(encryptionKey) !== 32) {
          encryptionKey = await this.dependencies.createEncryptionKey();
          if (utf8ByteLength(encryptionKey) !== 32)
            throw new Error('The secure cache key must contain exactly 32 bytes.');
          await this.dependencies.secureStore.set(CACHE_ENCRYPTION_KEY, encryptionKey);
        }
        return this.dependencies.openEncryptedCache(encryptionKey);
      })().catch((error: unknown) => {
        this.cache = undefined;
        throw error;
      });
    }
    return this.cache;
  }

  private removeCorruptCacheEntry(store: StringKeyValueStore, key: string) {
    try {
      store.remove(key);
    } catch {
      // A damaged native store can reject both reads and deletes; the next open retries recovery.
    }
  }

  private now() {
    return this.dependencies.now?.() ?? Date.now();
  }

  private clearInvalidSession(): Promise<void> {
    const write = this.sessionWrite
      .catch(() => undefined)
      .then(() => this.dependencies.secureStore.remove(SESSION_KEY));
    this.sessionWrite = write;
    return write;
  }
}
