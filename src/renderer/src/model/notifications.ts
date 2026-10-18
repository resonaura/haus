import type { HassEntity } from './types';
export interface HomeNotice {
  id: string;
  kind: 'notification' | 'update' | 'repair';
  title: string;
  message: string;
  createdAt?: string;
  entityId?: string;
  notificationId?: string;
  severity: 'info' | 'warning' | 'critical';
}
export type PersistentNotice = {
  notification_id: string;
  title?: string;
  message?: string;
  created_at?: string;
};
export interface RepairIssue {
  domain: string;
  issue_id: string;
  translation_key?: string;
  translation_placeholders?: Record<string, unknown>;
  severity?: string;
  created?: string;
  ignored?: boolean;
}
const label = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
export function applyNotificationUpdate(
  current: PersistentNotice[],
  update: { type: string; notifications: Record<string, PersistentNotice> },
) {
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
  states: HassEntity[],
  persistent: PersistentNotice[],
  repairs: RepairIssue[],
  resources: Record<string, string> = {},
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
      title: `${String(state.attributes.friendly_name ?? state.attributes.title ?? 'Software')} update`,
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
      return {
        id: `repair:${issue.domain}:${issue.issue_id}`,
        kind: 'repair',
        title: translate(resources[`${base}.title`] ?? `${label(issue.domain)} needs attention`),
        message: translate(resources[`${base}.description`] ?? 'Review this issue in Repairs.'),
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
