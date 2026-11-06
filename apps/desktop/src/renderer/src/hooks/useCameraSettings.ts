/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { cameraSettings } from '../ha/camera-settings';

export function useCameraSettings(id: string, enabled = true) {
  const camera = useSyncExternalStore(cameraSettings.subscribe, () =>
    enabled ? cameraSettings.get(id) : undefined,
  );
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void cameraSettings.refresh().catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [id, enabled]);
  return camera;
}
