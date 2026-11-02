/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { HausAccessory } from '../../model';
import { activeLights } from '../../model/active-lights';
import { reconcileDepartures, type Departure } from '../../model/departures';

export function useOnNow(items: HausAccessory[], enabled: boolean) {
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
    setEntries((previous) =>
      enabled
        ? reconcileDepartures(
            previous,
            activeLights(items).map((item) => item.id),
            items.filter((item) => item.availability === 'available').map((item) => item.id),
            performance.now(),
          )
        : [],
    );
  }, [items, enabled]);
  useEffect(() => {
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
  }, [entries, items]);
  return {
    items: entries
      .filter((entry) => entry.phase !== 'leaving')
      .flatMap((entry) => byId.get(entry.id) ?? []),
    retained: new Set(entries.map((entry) => entry.id)),
  };
}
