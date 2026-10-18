import { expect, it } from 'vitest';
import { snapshotAgeSeconds } from './snapshot-age';

it('distinguishes a missing frame from a fresh one and keeps aging across a failed refresh', () => {
  expect(snapshotAgeSeconds(0, 100000)).toBeUndefined();
  const loadedAt = 10000;
  expect(snapshotAgeSeconds(loadedAt, 10500)).toBe(0);
  expect(snapshotAgeSeconds(loadedAt, 27000)).toBe(17);
  // No new successful load means the same timestamp, even after another poll was attempted.
  expect(snapshotAgeSeconds(loadedAt, 39000)).toBe(29);
  expect(snapshotAgeSeconds(loadedAt, loadedAt - 1000)).toBe(0);
});
