/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { StatsStore } from '../../src/stats/stats.store.js';
import { openStatsSource } from '../../src/stats/stats.source.js';

export async function openTestStatsStore(path: string): Promise<StatsStore> {
  return new StatsStore(await openStatsSource(path));
}
