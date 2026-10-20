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
