/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect } from 'react';
import { cameraSettings } from '../../ha/camera-settings';
/** Only visible previews request a bounded, muted server lease. Battery cameras are rejected by the helper. */
export function useCameraPreheat(id: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !window.hausNative) return;
    const api = window.hausNative;
    const touch = (active: boolean) =>
      void api
        .helper({
          method: 'POST',
          path: `/api/cameras/${id}/warm`,
          data: { active, preview: true },
        })
        .catch(() => {});
    const update = () => {
      const visible = document.visibilityState === 'visible';
      touch(visible);
      if (visible) {
        void cameraSettings.refresh().catch(() => {});
      }
    };
    update();
    const timer = setInterval(update, 25000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      touch(false);
    };
  }, [id, enabled]);
}
