/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { NotificationQueue } from '../components/ui/notification-queue';

export function useAppNotifications() {
  const [notifications] = useState(() => new NotificationQueue());
  const lifetime = useRef(0);
  useEffect(() => {
    const current = ++lifetime.current;
    return () =>
      queueMicrotask(() => {
        if (lifetime.current === current) notifications.destroy();
      });
  }, [notifications]);
  return notifications;
}
