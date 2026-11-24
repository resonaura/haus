/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  gpuiStateDirectory,
  openGpuiCredentialStore,
  type KeyringEntry,
} from './credentials.js';

function memoryKeyring() {
  const values = new Map<string, string>();
  const createEntry = async (service: string, account: string): Promise<KeyringEntry> => {
    const key = `${service}\0${account}`;
    return {
      async getPassword() {
        return values.get(key) ?? null;
      },
      async setPassword(password: string) {
        values.set(key, password);
      },
      async deleteCredential() {
        return values.delete(key);
      },
    };
  };
  return { values, createEntry };
}

describe('gpuiStateDirectory', () => {
  it('resolves native app data directories on macOS, Windows, and Linux', () => {
    expect(gpuiStateDirectory('darwin', {}, '/Users/alex')).toBe(
      '/Users/alex/Library/Application Support/Haus GPUIX',
    );
    expect(gpuiStateDirectory('win32', { LOCALAPPDATA: '/Win/AppData/Local' }, '/Win')).toBe(
      '/Win/AppData/Local/Haus GPUIX',
    );
    expect(gpuiStateDirectory('linux', { XDG_DATA_HOME: '/xdg' }, '/home/alex')).toBe(
      '/xdg/haus-gpuix',
    );
  });
});

describe('openGpuiCredentialStore', () => {
  it('supports macOS, Windows, and Linux and validates Hub and HA credentials', async () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const keyring = memoryKeyring();
      let closed = false;
      const store = await openGpuiCredentialStore({
        platform,
        directory: `/tmp/state-${platform}`,
        acquireOwner: async () => ({
          fd: 7,
          close: async () => {
            closed = true;
          },
        }),
        createEntry: keyring.createEntry,
      });

      await store.saveHubSession({
        hubUrl: 'http://192.168.1.25:8790',
        sessionId: 'sess-1',
        sessionToken: 'secret-token',
        hubId: 'hub-1',
        homeId: 'home-1',
        clientId: 'client-1',
        clientName: 'Haus Desktop',
        clientRole: 'admin',
        expiresAt: 1_900_000_000_000,
      });
      await expect(store.loadHubSession()).resolves.toMatchObject({
        hubUrl: 'http://192.168.1.25:8790',
        sessionToken: 'secret-token',
        clientRole: 'admin',
      });

      await store.saveSession({
        url: 'http://homeassistant.local:8123/',
        name: 'Home Assistant',
        clientId: 'http://127.0.0.1:4567/',
        refreshToken: 'refresh-123',
      });
      await expect(store.loadSession()).resolves.toMatchObject({
        url: 'http://homeassistant.local:8123',
        refreshToken: 'refresh-123',
      });

      await store.clearHubSession();
      await expect(store.loadHubSession()).resolves.toBeNull();
      await store.clearSession();
      await expect(store.loadSession()).resolves.toBeNull();

      await store.close();
      expect(closed).toBe(true);
      expect(() => store.assertAvailable()).toThrow('Hub session owner is unavailable');
    }
  });

  it('rejects corrupt stored payloads and releases owner lock if keyring probe fails', async () => {
    let released = false;
    await expect(
      openGpuiCredentialStore({
        platform: 'win32',
        directory: '/tmp/fail',
        acquireOwner: async () => ({
          fd: 9,
          close: async () => {
            released = true;
          },
        }),
        createEntry: async () => ({
          getPassword: async () => {
            throw new Error('Keychain locked');
          },
          setPassword: async () => undefined,
          deleteCredential: async () => false,
        }),
      }),
    ).rejects.toThrow('operating system credential store could not be opened');
    expect(released).toBe(true);

    const keyring = memoryKeyring();
    const store = await openGpuiCredentialStore({
      platform: 'darwin',
      directory: '/tmp/corrupt',
      acquireOwner: async () => ({ fd: 11, close: async () => undefined }),
      createEntry: keyring.createEntry,
    });
    keyring.values.set('Haus GPUIX\0hub-session', '{bad-json');
    keyring.values.set('Haus GPUIX\0ha-session', JSON.stringify({ url: 'ftp://bad', refreshToken: '' }));
    await expect(store.loadHubSession()).rejects.toThrow('saved Hub session could not be read');
    await expect(store.loadSession()).rejects.toThrow(
      'saved Home Assistant session could not be read',
    );
    await store.close();
  });
});
