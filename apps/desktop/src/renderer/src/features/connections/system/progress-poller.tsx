/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect } from 'react';
import { nativeApi, type FlowProgress } from '../../../ha/management';

const PROGRESS_POLL_MS = 5_000;

export function DiscoveryProgressPoller({
  active,
  onProgress,
}: {
  active: boolean;
  onProgress: (progress: FlowProgress[]) => void;
}) {
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let reading = false;
    let warned = false;

    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const progress = await nativeApi().request<FlowProgress[]>({
          type: 'config_entries/flow/progress',
        });
        if (!stopped) {
          onProgress(progress);
          warned = false;
        }
      } catch {
        if (!stopped && !warned) {
          console.warn('Integration discovery status could not refresh; keeping previous results.');
          warned = true;
        }
      } finally {
        reading = false;
      }
    };

    const timer = window.setInterval(() => void refresh(), PROGRESS_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active, onProgress]);

  return null;
}
