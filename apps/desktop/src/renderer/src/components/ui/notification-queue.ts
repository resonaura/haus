/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HausToastQueue, type HausToastTone } from '@haus/ui';

export type NotificationTone = HausToastTone;

/** Bound memory during repeated connection errors; keep the newest notice visible in place. */
export class NotificationQueue {
  readonly queue = new HausToastQueue(3);
  private messages = new Map<string, { text: string; tone: NotificationTone }>();

  notify = (text: string, tone: NotificationTone = 'default'): void => {
    text = text.trim();
    if (!text) {
      this.clear();
      return;
    }
    const timeout = Math.min(
      12000,
      Math.max(tone === 'danger' ? 8500 : 6500, 3000 + text.length * 35),
    );
    const existing = [...this.messages].find(
      ([, item]) => item.text === text && item.tone === tone,
    )?.[0];
    const key =
      existing ?? (this.messages.size >= 3 ? [...this.messages.keys()].at(-1) : undefined);
    if (key && this.queue.update(key, text, tone, { timeout })) {
      this.messages.set(key, { text, tone });
      return;
    }
    if (key) this.messages.delete(key);
    const id = this.queue.add(text, tone, {
      timeout,
      onClose: () => this.messages.delete(id),
    });
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
