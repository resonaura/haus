import { expect, it, vi } from 'vitest';
import { CameraMetadataCache } from './camera-metadata-cache';
it('coalesces camera metadata, expires TURN configuration and clears across home changes', async () => {
  let now = 1000;
  const cache = new CameraMetadataCache(() => now);
  const load = vi.fn().mockResolvedValue({ configuration: {} });
  const message = { type: 'camera/webrtc/get_client_config', entity_id: 'camera.garden' };
  await Promise.all([cache.request(message, load), cache.request(message, load)]);
  expect(load).toHaveBeenCalledTimes(1);
  now += 30001;
  await cache.request(message, load);
  cache.clear();
  await cache.request(message, load);
  expect(load).toHaveBeenCalledTimes(3);
});
it('never caches media or offers and lets transient metadata errors retry', async () => {
  const cache = new CameraMetadataCache();
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
  const metadata = { type: 'camera/capabilities', entity_id: 'camera.entry' };
  await expect(cache.request(metadata, load)).rejects.toThrow('offline');
  await cache.request(metadata, load);
  for (let i = 0; i < 2; i++)
    await cache.request({ type: 'camera/stream', entity_id: 'camera.entry' }, load);
  expect(load).toHaveBeenCalledTimes(4);
});
