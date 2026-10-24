import { expect, it } from 'vitest';
import { formatSnapshotAge, snapshotAgeSeconds } from './snapshot-age';

it('distinguishes a missing frame from a fresh one and keeps aging across a failed refresh', () => {
  expect(snapshotAgeSeconds(0, 100000)).toBeUndefined();
  const loadedAt = 10000;
  expect(snapshotAgeSeconds(loadedAt, 10500)).toBe(0);
  expect(snapshotAgeSeconds(loadedAt, 27000)).toBe(17);
  // No new successful load means the same timestamp, even after another poll was attempted.
  expect(snapshotAgeSeconds(loadedAt, 39000)).toBe(29);
  expect(snapshotAgeSeconds(loadedAt, loadedAt - 1000)).toBe(0);
});

it.each([
  [0, '0s'],
  [59, '59s'],
  [60, '1m'],
  [3599, '59m'],
  [3600, '1h'],
  [86399, '23h'],
  [86400, '1d'],
  [91667, '1d'],
  [30 * 86400 - 1, '29d'],
  [30 * 86400, '1mo'],
  [365 * 86400 - 1, '12mo'],
  [365 * 86400, '1y'],
  [2 * 365 * 86400, '2y'],
])('formats %i seconds as the largest single unit %s', (seconds, label) => {
  expect(formatSnapshotAge(seconds)).toBe(label);
});
