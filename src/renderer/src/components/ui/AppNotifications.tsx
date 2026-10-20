import { Toast, type ToastContentValue } from '@heroui/react';
import type { NotificationQueue } from './notification-queue';
import './notifications.scss';

export function AppNotifications({ notifications }: { notifications: NotificationQueue }) {
  return (
    <Toast.Provider
      queue={notifications.queue}
      className="haus-toast-region"
      placement="bottom"
      aria-label="Notifications"
      width="min(420px, calc(100vw - 32px))"
      scaleFactor={0.035}
      gap={9}
    >
      {({ toast }) => {
        const content = toast.content as ToastContentValue;
        return (
          <Toast toast={toast} variant={content.variant} className="haus-toast">
            <Toast.Indicator variant={content.variant} />
            <Toast.Content>
              <Toast.Title>{content.title}</Toast.Title>
            </Toast.Content>
            <Toast.CloseButton aria-label="Dismiss notification" />
          </Toast>
        );
      }}
    </Toast.Provider>
  );
}
