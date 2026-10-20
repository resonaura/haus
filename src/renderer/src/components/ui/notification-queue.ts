import { ToastQueue, type ToastContentValue } from '@heroui/react';
export type NotificationTone = 'default' | 'success' | 'warning' | 'danger';

/** Bound memory during repeated connection errors; keep the newest notice visible in place. */
export class NotificationQueue {
  readonly queue = new ToastQueue({ maxVisibleToasts: 3, exitDuration: 180 });
  private messages = new Map<string, { text: string; tone: NotificationTone }>();
  notify = (text: string, tone: NotificationTone = 'default'): void => {
    text = text.trim();
    if (!text) {
      this.clear();
      return;
    }
    const content: ToastContentValue = { title: text, variant: tone };
    const timeout = Math.min(
      12000,
      Math.max(tone === 'danger' ? 8500 : 6500, 3000 + text.length * 35),
    );
    const existing = [...this.messages].find(
      ([, item]) => item.text === text && item.tone === tone,
    )?.[0];
    const key =
      existing ?? (this.messages.size >= 3 ? [...this.messages.keys()].at(-1) : undefined);
    if (key && this.queue.update(key, content, { timeout })) {
      this.messages.set(key, { text, tone });
      return;
    }
    if (key) this.messages.delete(key);
    const id = this.queue.add(content, { timeout, onClose: () => this.messages.delete(id) });
    this.messages.set(id, { text, tone });
  };
  clear() {
    this.messages.clear();
    this.queue.clear();
  }
  destroy() {
    this.messages.clear();
    this.queue.destroy();
  }
}
