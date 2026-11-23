/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it } from 'vitest';
import {
  defaultHoldDuration,
  departureDuration,
  reconcileDepartures,
  userClickHoldDuration,
} from './departures';

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

it('holds user-clicked Off lights for several seconds before leaving, while external Off stays brief', () => {
  let entries = reconcileDepartures([], ['a', 'b'], ['a', 'b'], 0);
  entries = reconcileDepartures(entries, [], ['a', 'b'], 100, new Set(['a']));
  expect(entries).toEqual([
    { id: 'a', phase: 'holding', until: 100 + userClickHoldDuration },
    { id: 'b', phase: 'holding', until: 100 + defaultHoldDuration },
  ]);

  // External light `b` transitions to leaving at defaultHoldDuration and finishes before `a`.
  entries = reconcileDepartures(entries, [], ['a', 'b'], 100 + defaultHoldDuration);
  expect(entries).toEqual([
    { id: 'a', phase: 'holding', until: 100 + userClickHoldDuration },
    { id: 'b', phase: 'leaving', until: 100 + defaultHoldDuration + departureDuration },
  ]);
  entries = reconcileDepartures(
    entries,
    [],
    ['a', 'b'],
    100 + defaultHoldDuration + departureDuration,
  );
  expect(entries).toEqual([{ id: 'a', phase: 'holding', until: 100 + userClickHoldDuration }]);

  // Turning `a` back on mid-hold cancels departure cleanly.
  entries = reconcileDepartures(entries, ['a'], ['a', 'b'], 2000);
  expect(entries).toEqual([{ id: 'a', phase: 'present', until: Infinity }]);

  // Turning `a` off again by click gives a full user hold, then transitions through leaving to gone.
  entries = reconcileDepartures(entries, [], ['a'], 2100, new Set(['a']));
  expect(entries[0]).toEqual({ id: 'a', phase: 'holding', until: 2100 + userClickHoldDuration });
  entries = reconcileDepartures(entries, [], ['a'], 2100 + userClickHoldDuration);
  expect(entries[0]).toEqual({
    id: 'a',
    phase: 'leaving',
    until: 2100 + userClickHoldDuration + departureDuration,
  });
  entries = reconcileDepartures(
    entries,
    [],
    ['a'],
    2100 + userClickHoldDuration + departureDuration,
  );
  expect(entries).toEqual([]);
});
