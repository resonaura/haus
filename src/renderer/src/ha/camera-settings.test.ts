import { expect, it, vi } from 'vitest';
import { CameraSettingsCache, type CameraSettings } from './camera-settings';
const camera: CameraSettings = {
  id: 'camera.test',
  enabled: true,
  aliases: ['camera.alias'],
  motionDetection: { enabled: false, mode: 'objects' },
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}
it('prefetches and shares a known policy synchronously when a settings drawer opens', async () => {
  const read = vi.fn().mockResolvedValue({ cameras: [camera] });
  const cache = new CameraSettingsCache(read, async () => {});
  cache.setScope('home:owner');
  await Promise.all([cache.refresh(), cache.refresh()]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(cache.get('camera.alias')).toBe(camera);
  await cache.refresh();
  expect(read).toHaveBeenCalledTimes(1);
});
it('keeps optimistic recording and analysis settings through a delayed older read and drawer reopening', async () => {
  const old = deferred<{ cameras: CameraSettings[] }>(),
    save = deferred<void>();
  const read = vi
    .fn()
    .mockResolvedValueOnce({ cameras: [camera] })
    .mockReturnValue(old.promise);
  const cache = new CameraSettingsCache(read, () => save.promise);
  cache.setScope('home');
  await cache.refresh();
  const stale = cache.refresh(true);
  const writing = cache.update('camera.alias', {
    enabled: false,
    motionDetection: { enabled: true, mode: 'motion' },
  });
  expect(cache.get('camera.test')?.enabled).toBe(false);
  old.resolve({ cameras: [camera] });
  await stale;
  expect(cache.get('camera.alias')?.enabled).toBe(false);
  expect(cache.get('camera.alias')?.motionDetection?.mode).toBe('motion');
  save.resolve();
  await writing;
  expect(cache.get('camera.alias')?.enabled).toBe(false);
});
it('rolls back failed writes and never leaks a previous home or its late response into another home', async () => {
  const write = deferred<void>();
  const cache = new CameraSettingsCache(
    async () => ({ cameras: [camera] }),
    () => write.promise,
  );
  cache.setScope('home');
  await cache.refresh();
  const saving = cache.update('camera.test', { enabled: false });
  write.reject(Error('offline'));
  await expect(saving).rejects.toThrow('offline');
  expect(cache.get('camera.test')?.enabled).toBe(true);
  const old = deferred<{ cameras: CameraSettings[] }>();
  const isolated = new CameraSettingsCache(
    () => old.promise,
    async () => {},
  );
  isolated.setScope('old-home');
  const read = isolated.refresh();
  isolated.setScope('new-home');
  old.resolve({ cameras: [camera] });
  await read;
  expect(isolated.get('camera.test')).toBeUndefined();
});
it('ignores a completed save after the home changes and blocks overlapping writes to the same camera', async () => {
  const write = deferred<void>();
  const cache = new CameraSettingsCache(
    async () => ({ cameras: [camera] }),
    () => write.promise,
  );
  cache.setScope('home');
  await cache.refresh();
  const saving = cache.update('camera.test', { enabled: false });
  await expect(cache.update('camera.alias', { enabled: true })).rejects.toThrow('being saved');
  cache.setScope('');
  write.resolve();
  await saving;
  expect(cache.get('camera.test')).toBeUndefined();
});
