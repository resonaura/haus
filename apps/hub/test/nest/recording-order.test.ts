/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { openTestRecordingStore } from './recording-test-store.js';

it('publishes a standalone recording read after the preceding playback transaction commits', async () => {
  const store = await openTestRecordingStore(':memory:', '/unused-media');
  try {
    const event = await store.create('camera.one', 'motion', 1000, 2000);
    await store.finish(event.id, { bytes: 10, playbackVersion: 0 });
    const [, observed] = await Promise.all([
      store.setPlayback(event.id, 20, 4, { duration: 2 }),
      store.get(event.id),
    ]);
    expect(observed?.playbackVersion).toBe(4);
    expect(observed?.playbackBytes).toBe(20);
    await store.archive.saveDescriptor({
      eventId: event.id,
      variant: 'prepared',
      digest: 'retained',
      bytes: 20,
      version: 4,
    });
    const generation = await store.archiveGeneration();
    await store.source.query(
      `CREATE TRIGGER reject_playback BEFORE UPDATE OF playback_version ON events BEGIN SELECT RAISE(ABORT,'fixture_write_failure'); END`,
    );
    const failedWrite = store.setPlayback(event.id, 99, 5);
    const afterFailure = store.get(event.id);
    await expect(failedWrite).rejects.toThrow('fixture_write_failure');
    expect(await afterFailure).toMatchObject({ playbackVersion: 4, playbackBytes: 20 });
    expect(await store.archive.descriptor(event.id, 'prepared', 4)).toMatchObject({
      digest: 'retained',
    });
    expect(await store.archiveGeneration()).toBe(generation);
  } finally {
    await store.close();
  }
});
