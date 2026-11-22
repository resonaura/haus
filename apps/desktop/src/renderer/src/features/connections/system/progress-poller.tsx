/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef } from 'react';
import { nativeApi, type FlowProgress } from '../../../ha/management';

const PROGRESS_POLL_MS = 5_000;

export function sameFlowProgress(a: readonly FlowProgress[], b: readonly FlowProgress[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const prev = a[i];
    const next = b[i];
    if (
      !prev ||
      !next ||
      prev.flow_id !== next.flow_id ||
      prev.handler !== next.handler ||
      prev.context?.source !== next.context?.source ||
      prev.context?.entry_id !== next.context?.entry_id ||
      prev.context?.title_placeholders?.name !== next.context?.title_placeholders?.name
    ) {
      return false;
    }
  }
  return true;
}

export function DiscoveryProgressPoller({
  active,
  onProgress,
}: {
  active: boolean;
  onProgress: (progress: FlowProgress[]) => void;
}) {
  const lastRef = useRef<readonly FlowProgress[] | null>(null);

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
          if (!lastRef.current || !sameFlowProgress(lastRef.current, progress)) {
            lastRef.current = progress;
            onProgress(progress);
          }
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
