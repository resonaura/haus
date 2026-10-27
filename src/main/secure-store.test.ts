import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const systemStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  encryptString: vi.fn((value: string) => Buffer.from(value).map((byte) => byte ^ 0x91)),
  decryptString: vi.fn((value: Buffer) => value.map((byte) => byte ^ 0x91).toString()),
}));
vi.mock('electron', () => ({ safeStorage: systemStorage }));
import { SecureStore } from './secure-store';

const directories: string[] = [];
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(async () => {
  Object.defineProperty(process, 'platform', originalPlatform);
  systemStorage.isEncryptionAvailable.mockReturnValue(true);
  systemStorage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret');
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{ directory: string; store: SecureStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'haus-storage-'));
  directories.push(directory);
  return { directory, store: new SecureStore(directory) };
}

describe('operating system credential storage', () => {
  it('encrypts scoped camera grants, merges camera entries and clears them on sign-out', async () => {
    const { directory, store } = await fixture();
    await Promise.all([
      store.saveCameraAccess('https://home.fixture', 'client', 'camera.a', {
        key: 'camera-private-key-a',
      }),
      store.saveCameraAccess('https://home.fixture', 'client', 'camera.b', {
        key: 'camera-private-key-b',
      }),
    ]);
    expect((await readFile(join(directory, 'camera-access.enc'))).toString()).not.toContain(
      'camera-private',
    );
    expect(await store.loadCameraAccess()).toMatchObject({
      scope: 'https://home.fixture',
      cameras: {
        'camera.a': { key: 'camera-private-key-a' },
        'camera.b': { key: 'camera-private-key-b' },
      },
    });
    await store.clearSession();
    expect(await store.loadCameraAccess()).toBeNull();
  });
  it('fails closed for an unavailable keychain and Linux basic_text', async () => {
    const { directory, store } = await fixture();
    const session = {
      url: 'http://homeassistant.local:8123',
      name: 'Home',
      clientId: 'http://127.0.0.1:43210/',
      refreshToken: 'private-refresh',
    };
    systemStorage.isEncryptionAvailable.mockReturnValue(false);
    await expect(store.saveSession(session)).rejects.toThrow(
      'Secure system storage is unavailable',
    );
    systemStorage.isEncryptionAvailable.mockReturnValue(true);
    Object.defineProperty(process, 'platform', { value: 'linux' });
    systemStorage.getSelectedStorageBackend.mockReturnValue('basic_text');
    await expect(store.saveSession(session)).rejects.toThrow(
      'Secure system storage is unavailable',
    );
    await expect(readFile(join(directory, 'session.enc'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('round-trips only encrypted session bytes and preserves sign-out ordering', async () => {
    const { directory, store } = await fixture();
    const session = {
      url: 'http://homeassistant.local:8123',
      name: 'Home',
      clientId: 'http://127.0.0.1:43210/',
      refreshToken: 'private-refresh',
    };
    await store.saveSession(session);
    expect((await readFile(join(directory, 'session.enc'))).toString()).not.toContain(
      session.refreshToken,
    );
    expect(await store.loadSession()).toEqual(session);
    await Promise.all([store.saveSession(session), store.clearSession()]);
    expect(await store.loadSession()).toBeNull();
  });

  it('merges concurrent preference patches without losing either change', async () => {
    const { store } = await fixture();
    await Promise.all([
      store.setPreferences({ favorites: ['light.desk'] }),
      store.setPreferences({ sidebarCollapsed: true }),
    ]);
    expect(await store.getPreferences()).toEqual({
      favorites: ['light.desk'],
      sidebarCollapsed: true,
    });
  });
});
