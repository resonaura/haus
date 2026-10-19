import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
import { safeStorage } from 'electron';
import { CameraSnapshotCache } from './camera-snapshot-cache';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it('keeps frames separate for each home and preserves the capture age when loading disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-snapshot-test-'));
  directories.push(root);
  const cache = new CameraSnapshotCache(root);
  const frame = { image: 'data:image/jpeg;base64,YWJj', receivedAt: 1000 };
  cache.put('https://home-a', 'camera.test', frame);
  expect(await cache.get('https://home-a', 'camera.test')).toEqual(frame);
  expect(await cache.get('https://home-b', 'camera.test')).toBeNull();
  await vi.waitFor(async () =>
    expect((await readdir(root)).filter((x) => !x.endsWith('.partial'))).toHaveLength(1),
  );
  expect(await new CameraSnapshotCache(root).get('https://home-a', 'camera.test')).toEqual(frame);
});
it('rejects unsupported content and keeps its in-memory frame budget bounded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-snapshot-test-'));
  directories.push(root);
  const cache = new CameraSnapshotCache(root);
  cache.put('home', 'camera.test', { image: 'https://arbitrary.example', receivedAt: 1 });
  expect(await cache.get('home', 'camera.test')).toBeNull();
});

it('evicts the oldest frame rather than dropping the new one at capacity', async () => {
  const disabled = vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(false);
  try {
    const cache = new CameraSnapshotCache('/not-used');
    for (let index = 0; index < 26; index++)
      cache.put('home', `camera.${index}`, {
        image: 'data:image/jpeg;base64,YWJj',
        receivedAt: index,
      });
    expect(await cache.get('home', 'camera.0')).toBeNull();
    expect(await cache.get('home', 'camera.1')).toBeNull();
    expect((await cache.get('home', 'camera.25'))?.receivedAt).toBe(25);
    expect((await cache.get('home', 'camera.2'))?.receivedAt).toBe(2);
  } finally {
    disabled.mockRestore();
  }
});

it('keeps Linux frames in memory when the desktop has no encrypted keyring', async () => {
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  const backend = vi.spyOn(safeStorage, 'getSelectedStorageBackend').mockReturnValue('basic_text');
  try {
    const root = await mkdtemp(join(tmpdir(), 'haus-snapshot-test-'));
    directories.push(root);
    const frame = { image: 'data:image/jpeg;base64,YWJj', receivedAt: 2000 };
    const cache = new CameraSnapshotCache(root);
    cache.put('home', 'camera.test', frame);
    expect(await cache.get('home', 'camera.test')).toEqual(frame);
    expect(await new CameraSnapshotCache(root).get('home', 'camera.test')).toBeNull();
    expect(await readdir(root)).toEqual([]);
  } finally {
    backend.mockRestore();
    Object.defineProperty(process, 'platform', { value: platform });
  }
});
