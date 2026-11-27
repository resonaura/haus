/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { validateSessionCredentials } from '@haus/core/auth';
import { normalizeServerUrl } from '@haus/core/hub';
import { isRecord } from '@haus/core/record';
import type { CachedCameraSnapshot, CredentialStore, StoredSession } from '@haus/ha/native-types';
import type { HubSessionManagerDependencies } from '../main/hub-session.js';
import { acquireHubSessionOwner } from './owner.js';

const KEYRING_SERVICE = 'Haus GPUIX';
const MAX_SNAPSHOT_ENTRIES = 24;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_DATA_LENGTH = 8 * 1024 ** 2 + 64;

export interface KeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(password: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
}

export interface GpuiCredentialStoreOptions {
  readonly platform?: NodeJS.Platform;
  readonly directory?: string;
  readonly acquireOwner?: (directory: string) => Promise<Pick<FileHandle, 'fd' | 'close'>>;
  readonly createEntry?: (service: string, account: string) => Promise<KeyringEntry>;
}

export type GpuiCredentialStore = HubSessionManagerDependencies['store'] &
  CredentialStore & {
    close(): Promise<void>;
  };

export function gpuiStateDirectory(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Haus GPUIX');
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Haus GPUIX');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'haus-gpuix');
}

function validateHaSession(value: unknown): StoredSession | null {
  if (
    !isRecord(value) ||
    typeof value.url !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.clientId !== 'string' ||
    typeof value.refreshToken !== 'string' ||
    !value.refreshToken.trim()
  ) {
    return null;
  }
  try {
    return {
      url: normalizeServerUrl(value.url),
      name: value.name,
      clientId: value.clientId,
      refreshToken: value.refreshToken,
    };
  } catch {
    return null;
  }
}

function createMemorySnapshotCache(): CredentialStore['cameraSnapshots'] {
  const entries = new Map<string, CachedCameraSnapshot>();
  const keyFor = (home: string, id: string) => `${home}\0${id}`;
  return {
    async get(home: string, id: string) {
      return entries.get(keyFor(home, id)) ?? null;
    },
    put(home: string, id: string, value: CachedCameraSnapshot) {
      if (
        typeof value?.image !== 'string' ||
        !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value.image) ||
        value.image.length > MAX_IMAGE_DATA_LENGTH ||
        !Number.isFinite(value.receivedAt)
      ) {
        return;
      }
      const key = keyFor(home, id);
      entries.delete(key);
      entries.set(key, value);
      let bytes = 0;
      let count = 0;
      for (const [entryKey, frame] of [...entries].reverse()) {
        bytes += frame.image.length;
        if (++count > MAX_SNAPSHOT_ENTRIES || bytes > MAX_SNAPSHOT_BYTES) {
          entries.delete(entryKey);
        }
      }
    },
  };
}

async function defaultCreateEntry(service: string, account: string): Promise<KeyringEntry> {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  return new AsyncEntry(service, account, {
    linux: { store: 'secret-service' },
  });
}

export async function openGpuiCredentialStore(
  options: GpuiCredentialStoreOptions = {},
): Promise<GpuiCredentialStore> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    throw new Error('Haus Hub sessions are supported on macOS, Windows, and Linux.');
  }
  const directory = options.directory ?? gpuiStateDirectory(platform);
  const acquireOwner =
    options.acquireOwner ?? ((dir: string) => acquireHubSessionOwner(dir, { platform }));
  const owner = await acquireOwner(directory);
  const createEntry = options.createEntry ?? defaultCreateEntry;
  let closed = false;

  try {
    const [hubEntry, haEntry] = await Promise.all([
      createEntry(KEYRING_SERVICE, 'hub-session'),
      createEntry(KEYRING_SERVICE, 'ha-session'),
    ]);
    // Resolving a native entry does not open the credential backend until the first operation.
    await hubEntry.getPassword();
    await haEntry.getPassword();

    const assertAvailable = () => {
      if (closed || owner.fd < 0) throw new Error('The Hub session owner is unavailable.');
    };

    return {
      assertAvailable,
      cameraSnapshots: createMemorySnapshotCache(),
      async loadHomeCache() {
        return null;
      },
      async saveHomeCache() {
        /* Unencrypted home snapshots are never written to disk by the GPUIX store. */
      },
      async loadHubSession() {
        assertAvailable();
        const saved = await hubEntry.getPassword();
        if (saved === null) return null;
        let parsed: unknown;
        try {
          parsed = JSON.parse(saved);
        } catch {
          throw new Error('The saved Hub session could not be read.');
        }
        const value = validateSessionCredentials(parsed);
        if (!value) throw new Error('The saved Hub session could not be read.');
        return value;
      },
      async saveHubSession(value) {
        assertAvailable();
        const validated = validateSessionCredentials(value);
        if (!validated) throw new Error('Refusing to store invalid Hub session credentials.');
        await hubEntry.setPassword(JSON.stringify(validated));
      },
      async clearHubSession() {
        assertAvailable();
        await hubEntry.deleteCredential();
      },
      async loadSession() {
        assertAvailable();
        const saved = await haEntry.getPassword();
        if (saved === null) return null;
        let parsed: unknown;
        try {
          parsed = JSON.parse(saved);
        } catch {
          throw new Error('The saved Home Assistant session could not be read.');
        }
        const value = validateHaSession(parsed);
        if (!value) throw new Error('The saved Home Assistant session could not be read.');
        return value;
      },
      async saveSession(value) {
        assertAvailable();
        const validated = validateHaSession(value);
        if (!validated) throw new Error('Refusing to store invalid Home Assistant session.');
        await haEntry.setPassword(JSON.stringify(validated));
      },
      async clearSession() {
        assertAvailable();
        await haEntry.deleteCredential();
      },
      async close() {
        if (closed) return;
        closed = true;
        await owner.close();
      },
    };
  } catch {
    await owner.close().catch(() => undefined);
    throw new Error('The operating system credential store could not be opened.');
  }
}
