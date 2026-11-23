/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import type { HausAccessory } from '../../model';
import { activeLights } from '../../model/active-lights';
import { reconcileDepartures, type Departure } from '../../model/departures';

function readActiveUserDismissed(
  source: Map<string, number> | undefined,
  now: number,
): ReadonlySet<string> | undefined {
  if (!source || source.size === 0) return undefined;
  const active = new Set<string>();
  for (const [id, expiresAt] of source) {
    if (expiresAt > now) active.add(id);
  }
  return active.size > 0 ? active : undefined;
}

export function useOnNow(
  items: HausAccessory[],
  enabled: boolean,
  userDismissedRef?: RefObject<Map<string, number>>,
) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const [entries, setEntries] = useState<Departure[]>(() =>
    reconcileDepartures(
      [],
      enabled ? activeLights(items).map((item) => item.id) : [],
      [],
      performance.now(),
    ),
  );
  useLayoutEffect(() => {
    const now = performance.now();
    const userDismissed = enabled
      ? readActiveUserDismissed(userDismissedRef?.current, now)
      : undefined;
    setEntries((previous) =>
      enabled
        ? reconcileDepartures(
            previous,
            activeLights(items).map((item) => item.id),
            items.filter((item) => item.availability === 'available').map((item) => item.id),
            now,
            userDismissed,
          )
        : [],
    );
  }, [items, enabled, userDismissedRef]);
  useEffect(() => {
    const dismissed = userDismissedRef?.current;
    if (dismissed && dismissed.size > 0) {
      const now = performance.now();
      for (const [id, expiresAt] of dismissed) {
        if (expiresAt <= now) dismissed.delete(id);
      }
      for (const entry of entries) {
        if (entry.phase !== 'present') dismissed.delete(entry.id);
      }
    }
    const until = Math.min(...entries.map((entry) => entry.until));
    if (!Number.isFinite(until)) return;
    const timer = setTimeout(
      () =>
        setEntries((previous) =>
          reconcileDepartures(
            previous,
            activeLights(items).map((item) => item.id),
            items.filter((item) => item.availability === 'available').map((item) => item.id),
            performance.now(),
          ),
        ),
      Math.max(0, until - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [entries, items, userDismissedRef]);
  useEffect(() => {
    const ref = userDismissedRef;
    if (!enabled) ref?.current.clear();
    return () => {
      ref?.current.clear();
    };
  }, [enabled, userDismissedRef]);
  return {
    items: entries
      .filter((entry) => entry.phase !== 'leaving')
      .flatMap((entry) => byId.get(entry.id) ?? []),
    retained: new Set(entries.map((entry) => entry.id)),
  };
}
