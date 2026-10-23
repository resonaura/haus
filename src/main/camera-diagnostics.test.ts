import { expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CameraDiagnostics } from './camera-diagnostics';
import { sanitizeCameraDiagnostic } from '../shared/camera-diagnostics';
const event = {
  camera: 'camera.fixture',
  viewer: 'test-1',
  event: 'fallback-failed',
  reason: 'hls-request',
};
it('logs only allowlisted controller fields, never arbitrary text, addresses or non-finite values', () => {
  expect(
    sanitizeCameraDiagnostic({
      ...event,
      url: 'rtsp://private',
      token: 'secret',
      message: 'secret',
      width: Infinity,
      source: 'secret',
      hlsDetail: 'rtsp://private',
      hlsType: 'private-value',
      mediaErrorCode: NaN,
      elapsedMs: 2.123456,
    }),
  ).toEqual({ ...event, elapsedMs: 2.123 });
  expect(sanitizeCameraDiagnostic({ ...event, camera: 'https://private' })).toBeUndefined();
  expect(sanitizeCameraDiagnostic({ ...event, event: 'arbitrary-secret' })).toBeUndefined();
});
it('serializes concurrent writes and retains only two bounded private local files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-camera-log-'));
  try {
    const log = new CameraDiagnostics(directory, 700);
    for (let n = 0; n < 30; n++) log.write({ ...event, elapsedMs: n, message: 'do not persist' });
    await log.flush();
    const files = await readdir(directory);
    expect(files.sort()).toEqual(['camera.log', 'camera.previous.log']);
    for (const file of files) {
      const path = join(directory, file);
      expect((await stat(path)).size).toBeLessThanOrEqual(700);
      const contents = await readFile(path, 'utf8');
      expect(contents).not.toContain('do not persist');
      const rows = contents
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(
        rows.every((row) => row.camera === 'camera.fixture' && typeof row.at === 'string'),
      ).toBe(true);
    }
    expect(
      JSON.parse((await readFile(join(directory, 'camera.log'), 'utf8')).trim().split('\n').at(-1)!)
        .elapsedMs,
    ).toBe(29);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('retains useful decoder failure codes while excluding detail text', () => {
  expect(
    sanitizeCameraDiagnostic({
      ...event,
      event: 'transport-error',
      hlsType: 'mediaError',
      hlsDetail: 'reset',
      fatal: true,
      mediaErrorCode: 3,
      fragmentSequence: 8,
      continuityCounter: 1,
      error: { message: 'secret' },
      response: { url: 'rtsp://private' },
    }),
  ).toEqual({
    ...event,
    event: 'transport-error',
    hlsType: 'mediaError',
    hlsDetail: 'reset',
    fatal: true,
    mediaErrorCode: 3,
    fragmentSequence: 8,
    continuityCounter: 1,
  });
});
