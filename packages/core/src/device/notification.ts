/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IssueSeverity, NotificationPriority } from './enums.js';

export interface NotificationAction {
  readonly actionId: string;
  readonly title: string;
  readonly destructive?: boolean;
}

export interface NotificationMedia {
  readonly type: 'image' | 'video';
  readonly url: string;
}

/** Actionable notification sent to desktop/mobile clients with rich media and lockscreen action buttons. */
export interface ActionableNotification {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly priority: NotificationPriority;
  readonly media?: NotificationMedia;
  readonly actions?: readonly NotificationAction[];
  readonly createdAt: string;
  readonly persistent?: boolean;
}

export interface NotificationActionResponse {
  readonly notificationId: string;
  readonly actionId: string;
  readonly timestamp: string;
}

/** System issue or repair ticket with optional 1-click interactive resolution. */
export interface SystemIssue {
  readonly id: string;
  readonly domain: string;
  readonly severity: IssueSeverity;
  readonly title: string;
  readonly description: string;
  readonly fixable: boolean;
  readonly repairFlowId?: string;
  readonly learnMoreUrl?: string;
  readonly createdAt: string;
}
