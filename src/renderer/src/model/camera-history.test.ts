import { expect, it } from 'vitest';
import { nextRecording, type CameraEvent } from './camera-history';
const event = (id: string, startAt: number, status = 'ready') =>
  ({ id, startAt, status }) as CameraEvent;
it('plays available recordings chronologically, skips failed/pending clips, and stops at the end', () => {
  const clips = [event('d', 4), event('c', 3, 'recording'), event('b', 2, 'failed'), event('a', 1)];
  expect(nextRecording(clips, 'a')?.id).toBe('d');
  expect(nextRecording(clips, 'd')).toBeUndefined();
  expect(nextRecording(clips, 'deleted')).toBeUndefined();
  expect(nextRecording([event('b', 1), event('a', 1)], 'a')?.id).toBe('b');
});
