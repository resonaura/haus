import { expect, it } from 'vitest';
import {
  canPlayOriginalImmediately,
  nextRecording,
  recordingSeek,
  type CameraEvent,
} from './camera-history';
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
it('skips selected-clip processing only for originals verified by the current compatibility policy', () => {
  const verified = {
    ...event('verified', 1),
    playbackInfo: { originalCompatible: true, originalPolicyVersion: 1 },
  };
  expect(canPlayOriginalImmediately(verified)).toBe(true);
  expect(
    canPlayOriginalImmediately({
      ...event('stale', 2),
      playbackInfo: { originalCompatible: true, originalPolicyVersion: 0 },
    }),
  ).toBe(false);
  expect(
    canPlayOriginalImmediately({
      ...event('unknown', 3),
      playbackInfo: { originalCompatible: true },
    }),
  ).toBe(false);
  expect(
    canPlayOriginalImmediately({
      ...event('incompatible', 4),
      playbackInfo: { originalCompatible: false, originalPolicyVersion: 1 },
    }),
  ).toBe(false);
});
