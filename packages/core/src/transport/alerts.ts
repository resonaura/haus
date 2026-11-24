/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { TransportEntityState } from './contract.js';

export interface PendingPairingRequest {
  readonly sessionId: string;
  readonly challengeCode: string;
  readonly createdAt?: number;
  readonly expiresAt?: string;
}

export interface HomeNotice {
  readonly id: string;
  readonly kind: 'notification' | 'update' | 'repair';
  readonly title: string;
  readonly message: string;
  readonly createdAt?: string;
  readonly entityId?: string;
  readonly notificationId?: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

export interface PersistentNotice {
  readonly notification_id: string;
  readonly title?: string;
  readonly message?: string;
  readonly created_at?: string;
}

export interface RepairIssue {
  readonly domain: string;
  readonly issue_id: string;
  readonly title?: string;
  readonly description?: string;
  readonly translation_key?: string;
  readonly translation_placeholders?: Record<string, unknown>;
  readonly severity?: string;
  readonly created?: string;
  readonly ignored?: boolean;
  readonly is_fixable?: boolean;
  readonly issue_domain?: string;
}

export interface AlertsTransport {
  readonly connected: boolean;
  /** True when connecting directly to a Haus Hub that supports device pairing approvals. */
  readonly supportsPairingRequests?: boolean;
  /** True when a null notification fetch should surface a reconnect error banner. */
  readonly reportNotificationLoadError?: boolean;
  readonly request: <T = unknown>(message: Record<string, unknown>) => Promise<T>;
  readonly management?: (input: {
    readonly method: 'GET' | 'POST' | 'DELETE';
    readonly path: string;
    readonly data?: unknown;
  }) => Promise<unknown>;
}

export interface AlertsData {
  readonly persistent: PersistentNotice[];
  readonly repairs: RepairIssue[];
  readonly resources: Record<string, string>;
  readonly pairingRequests: PendingPairingRequest[];
  readonly error: string;
}

export interface AlertsSnapshot extends AlertsData {
  readonly activePairing: PendingPairingRequest | null;
}

export function applyNotificationUpdate(
  current: readonly PersistentNotice[],
  update: { readonly type: string; readonly notifications: Record<string, PersistentNotice> },
): PersistentNotice[] {
  const values = Object.entries(update.notifications ?? {}).map(([id, value]) => ({
    ...value,
    notification_id: value?.notification_id ?? id,
  }));
  if (update.type === 'current') return values;
  if (update.type === 'removed') {
    const ids = new Set(Object.keys(update.notifications));
    return current.filter((item) => !ids.has(item.notification_id));
  }
  const next = new Map(current.map((item) => [item.notification_id, item]));
  for (const value of values) next.set(value.notification_id, value);
  return [...next.values()];
}

export function homeNotifications(
  states: readonly TransportEntityState[],
  persistent: readonly PersistentNotice[],
  repairs: readonly RepairIssue[],
  resources: Readonly<Record<string, string>> = {},
): HomeNotice[] {
  const updates: HomeNotice[] = states
    .filter(
      (state) =>
        state.entity_id.startsWith('update.') &&
        state.state === 'on' &&
        state.attributes.skipped_version !== state.attributes.latest_version,
    )
    .map((state) => ({
      id: state.entity_id,
      kind: 'update',
      title: String(state.attributes.friendly_name ?? state.attributes.title ?? 'Software').replace(
        /(?: update)?$/i,
        ' update',
      ),
      message: `${state.attributes.installed_version ?? 'Installed'} → ${state.attributes.latest_version ?? 'New version available'}`,
      entityId: state.entity_id,
      severity: 'info',
    }));

  const messages: HomeNotice[] = persistent.map((item) => ({
    id: `notification:${item.notification_id}`,
    kind: 'notification',
    title: item.title || 'Home notification',
    message: item.message ?? '',
    createdAt: item.created_at,
    notificationId: item.notification_id,
    severity: 'info',
  }));

  const issues: HomeNotice[] = repairs
    .filter((issue) => !issue.ignored)
    .map((issue) => {
      const base = `component.${issue.domain}.issues.${issue.translation_key}`;
      const translate = (value: string) =>
        value.replace(/\{(\w+)\}/g, (match, key: string) =>
          String(issue.translation_placeholders?.[key] ?? match),
        );
      const domainTitle = resources[`component.${issue.domain}.title`] ?? issue.domain;
      return {
        id: `repair:${issue.domain}:${issue.issue_id}`,
        kind: 'repair',
        title: translate(
          resources[`${base}.title`] ?? issue.title ?? `${domainTitle} needs attention`,
        ),
        message: translate(
          resources[`${base}.description`] ?? issue.description ?? 'Review this issue in Repairs.',
        ),
        createdAt: issue.created,
        severity:
          issue.severity === 'critical' || issue.severity === 'error' ? 'critical' : 'warning',
      };
    });

  const rank = { critical: 0, warning: 1, info: 2 };
  return [...issues, ...messages, ...updates].sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '') ||
      a.id.localeCompare(b.id),
  );
}

const EMPTY_ALERTS_DATA: AlertsData = {
  persistent: [],
  repairs: [],
  resources: {},
  pairingRequests: [],
  error: '',
};

const INITIAL_SNAPSHOT: AlertsSnapshot = {
  ...EMPTY_ALERTS_DATA,
  activePairing: null,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parsePairingRequests(result: unknown): PendingPairingRequest[] {
  if (!isRecord(result) || !Array.isArray(result.requests)) return [];
  return result.requests.filter(
    (entry): entry is PendingPairingRequest =>
      isRecord(entry) &&
      typeof entry.sessionId === 'string' &&
      typeof entry.challengeCode === 'string',
  );
}

export async function loadHomeAlerts(transport: AlertsTransport): Promise<AlertsData> {
  if (!transport.connected) return EMPTY_ALERTS_DATA;
  let persistent: PersistentNotice[] = [];
  let repairs: RepairIssue[] = [];
  let resources: Record<string, string> = {};
  let error = '';

  const [noticeRes, repairsRes, pairingRes] = await Promise.all([
    transport
      .request<PersistentNotice[]>({ type: 'persistent_notification/get' })
      .catch(() => null),
    transport
      .request<{ issues?: RepairIssue[] }>({ type: 'repairs/list_issues' })
      .catch(() => null),
    transport.supportsPairingRequests && transport.management
      ? transport
          .management({ method: 'GET', path: 'auth/pairing-requests' })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  if (Array.isArray(noticeRes)) {
    persistent = noticeRes;
  } else if (noticeRes === null && transport.reportNotificationLoadError) {
    error = 'Notifications could not be loaded. Reconnect to retry.';
  }

  if (repairsRes && Array.isArray(repairsRes.issues)) {
    repairs = repairsRes.issues;
    const domains = [...new Set(repairs.map((issue) => issue.domain))];
    if (domains.length > 0) {
      const [issuesRes, titlesRes] = await Promise.all([
        transport
          .request<{ resources?: Record<string, string> }>({
            type: 'frontend/get_translations',
            language: 'en',
            category: 'issues',
            integration: domains,
          })
          .catch(() => null),
        transport
          .request<{ resources?: Record<string, string> }>({
            type: 'frontend/get_translations',
            language: 'en',
            category: 'title',
            integration: domains,
          })
          .catch(() => null),
      ]);
      resources = {
        ...titlesRes?.resources,
        ...issuesRes?.resources,
      };
    }
  }

  return {
    persistent,
    repairs,
    resources,
    pairingRequests: parsePairingRequests(pairingRes),
    error,
  };
}

export async function dismissHomeNotification(
  transport: AlertsTransport,
  notificationId: string,
): Promise<void> {
  if (!transport.connected) return;
  await transport.request({
    type: 'call_service',
    domain: 'persistent_notification',
    service: 'dismiss',
    service_data: { notification_id: notificationId },
  });
}

export async function dismissHubPairingRequest(
  transport: AlertsTransport,
  sessionId: string,
): Promise<void> {
  if (!transport.management) return;
  await transport.management({
    method: 'POST',
    path: 'auth/pairing-requests/dismiss',
    data: { sessionId },
  });
}

/**
 * Hub-agnostic alerts & pairing-request coordinator shared by GPUI desktop, Web, and Mobile.
 */
export class AlertsMonitor {
  private snapshot: AlertsSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private generation = 0;

  constructor(private transport?: AlertsTransport) {}

  setTransport(transport?: AlertsTransport): void {
    this.transport = transport;
    if (!transport?.connected) {
      this.generation++;
      this.setState(INITIAL_SNAPSHOT);
      return;
    }
    void this.refresh();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AlertsSnapshot => this.snapshot;

  noticesFor(states: readonly TransportEntityState[], demo?: boolean): HomeNotice[] {
    if (demo) return [];
    return homeNotifications(
      states,
      this.snapshot.persistent,
      this.snapshot.repairs,
      this.snapshot.resources,
    );
  }

  start(pollMs = 4000): () => void {
    this.stop();
    if (this.transport?.connected) {
      void this.refresh();
    }
    this.timer = setInterval(() => {
      if (this.transport?.connected) void this.refresh();
    }, pollMs);
    return () => this.stop();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<void> {
    const active = this.transport;
    const token = ++this.generation;
    if (!active?.connected) {
      this.setState(INITIAL_SNAPSHOT);
      return;
    }
    const data = await loadHomeAlerts(active);
    if (token !== this.generation || this.transport !== active) return;
    this.setState({
      ...data,
      activePairing: data.pairingRequests[0] ?? null,
    });
  }

  async dismissNotice(notificationId: string): Promise<void> {
    if (!this.transport?.connected) return;
    await dismissHomeNotification(this.transport, notificationId);
    const persistent = this.snapshot.persistent.filter(
      (item) => item.notification_id !== notificationId,
    );
    this.setState({ ...this.snapshot, persistent });
    await this.refresh();
  }

  async dismissPairing(sessionId: string): Promise<void> {
    const pairingRequests = this.snapshot.pairingRequests.filter(
      (item) => item.sessionId !== sessionId,
    );
    this.setState({
      ...this.snapshot,
      pairingRequests,
      activePairing: pairingRequests[0] ?? null,
    });
    if (!this.transport) return;
    await dismissHubPairingRequest(this.transport, sessionId).catch(() => undefined);
  }

  private setState(next: AlertsSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
