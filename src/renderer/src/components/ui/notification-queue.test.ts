import { afterEach, expect, it, vi } from 'vitest';
import { NotificationQueue } from './notification-queue';
afterEach(() => vi.useRealTimers());
it('deduplicates repeated errors and bounds bursts while retaining the latest message', () => {
  vi.useFakeTimers();
  const notifications = new NotificationQueue();
  try {
    notifications.notify('Connection lost', 'danger');
    const id = notifications.queue.visibleToasts[0].key;
    notifications.notify('Connection lost', 'danger');
    expect(notifications.queue.visibleToasts).toHaveLength(1);
    expect(notifications.queue.visibleToasts[0].key).toBe(id);
    for (let i = 0; i < 20; i++) notifications.notify('Message ' + i);
    expect(notifications.queue.visibleToasts).toHaveLength(3);
    expect(
      notifications.queue.visibleToasts.some((item) => item.content.title === 'Message 19'),
    ).toBe(true);
  } finally {
    notifications.destroy();
  }
});
it('clears all notices across a home change and can publish again after exit cleanup', () => {
  vi.useFakeTimers();
  const notifications = new NotificationQueue();
  try {
    notifications.notify('Old home');
    notifications.notify('');
    vi.advanceTimersByTime(200);
    expect(notifications.queue.visibleToasts).toHaveLength(0);
    notifications.notify('New home');
    expect(notifications.queue.visibleToasts.map((item) => item.content.title)).toEqual([
      'New home',
    ]);
  } finally {
    notifications.destroy();
  }
});
