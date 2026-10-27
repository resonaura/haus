import { expect, it } from 'vitest';
import { reconcileDepartures } from './departures';

it('retains Off briefly without extending its deadline on later telemetry, then releases its row', () => {
  let entries = reconcileDepartures([], ['a', 'b'], ['a', 'b'], 0);
  entries = reconcileDepartures(entries, ['b'], ['a', 'b'], 100);
  expect(entries[0]).toEqual({ id: 'a', phase: 'holding', until: 950 });
  entries = reconcileDepartures(entries, ['b'], ['a', 'b'], 800);
  expect(entries[0].until).toBe(950);
  entries = reconcileDepartures(entries, ['b'], ['a', 'b'], 950);
  expect(entries[0].phase).toBe('leaving');
  entries = reconcileDepartures(entries, ['b'], ['a', 'b'], 1370);
  expect(entries.map((entry) => entry.id)).toEqual(['b']);
});

it('reactivation cancels a departure; another Off starts a fresh hold and a new visit starts clean', () => {
  let entries = reconcileDepartures([], ['a'], ['a'], 0);
  entries = reconcileDepartures(entries, [], ['a'], 10);
  entries = reconcileDepartures(entries, [], ['a'], 860);
  expect(entries[0].phase).toBe('leaving');
  entries = reconcileDepartures(entries, ['a'], ['a'], 900);
  expect(entries[0].phase).toBe('present');
  entries = reconcileDepartures(entries, [], ['a'], 1000);
  expect(entries[0].until).toBe(1850);
  expect(reconcileDepartures([], [], ['a'], 1100)).toEqual([]);
});

it('removed or unavailable controls skip the Off hold and simultaneous departures expire independently', () => {
  let entries = reconcileDepartures([], ['a', 'b'], ['a', 'b'], 0);
  entries = reconcileDepartures(entries, [], ['b'], 10);
  expect(entries.map((entry) => entry.phase)).toEqual(['leaving', 'holding']);
  entries = reconcileDepartures(entries, [], ['b'], 430);
  expect(entries.map((entry) => entry.id)).toEqual(['b']);
});
