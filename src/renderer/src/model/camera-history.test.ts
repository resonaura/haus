import { expect, it } from 'vitest';
import { nextRecording, recordingSeek, type CameraEvent } from './camera-history';
const event = (id: string, startAt: number, status = 'ready') =>
  ({ id, startAt, status }) as CameraEvent;
it('plays available recordings chronologically, skips failed/pending clips, and stops at the end', () => {
  const clips = [event('d', 4), event('c', 3, 'recording'), event('b', 2, 'failed'), event('a', 1)];
  expect(nextRecording(clips, 'a')?.id).toBe('d');
  expect(nextRecording(clips, 'd')).toBeUndefined();
  expect(nextRecording(clips, 'deleted')).toBeUndefined();
  expect(nextRecording([event('b', 1), event('a', 1)], 'a')?.id).toBe('b');
});
it('keeps a scrub on a decoded frame when prepared media is shorter than the cached archive duration', () => {
  expect(recordingSeek(1200, 78)).toBe(77.95);
  expect(recordingSeek(12, 78)).toBe(12);
  expect(recordingSeek(12, NaN)).toBe(12);
  expect(recordingSeek(-1, 78)).toBe(0);
});
