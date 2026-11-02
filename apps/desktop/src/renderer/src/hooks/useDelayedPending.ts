/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { pendingFeedbackDelay } from '../model/pending-feedback';

/** Keep quick commands quiet; measure from the shared command time across views. */
export function useDelayedPending(pending: boolean, since?: number): boolean {
  const key = since ?? 'local';
  const [visibleFor, setVisibleFor] = useState<number | 'local'>();
  useEffect(() => {
    setVisibleFor(undefined);
    if (!pending) return;
    const timer = setTimeout(() => setVisibleFor(key), pendingFeedbackDelay(since));
    return () => clearTimeout(timer);
  }, [pending, since, key]);
  return pending && visibleFor === key;
}
