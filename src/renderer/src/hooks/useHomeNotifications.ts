import { useEffect, useMemo, useState } from 'react';
import {
  applyNotificationUpdate,
  homeNotifications,
  type PersistentNotice,
  type RepairIssue,
} from '../model/notifications';
import type { Snapshot } from '../model';
export function useHomeNotifications(snapshot: Snapshot, connected: boolean, scope?: string) {
  const [persistent, setPersistent] = useState<PersistentNotice[]>([]);
  const [repairs, setRepairs] = useState<RepairIssue[]>([]);
  const [resources, setResources] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    setPersistent([]);
    setRepairs([]);
    setResources({});
    setError('');
    const api = window.hausNative;
    if (!api || !connected) return;
    let active = true;
    let off: (() => void) | undefined;
    let repairTimer: ReturnType<typeof setTimeout>;
    const refreshRepairs = async () => {
      try {
        const result = await api.request<{ issues: RepairIssue[] }>({
          type: 'repairs/list_issues',
        });
        if (!active) return;
        setRepairs(result.issues ?? []);
        const domains = [...new Set(result.issues.map((item) => item.domain))];
        if (domains.length) {
          const translations = await api
            .request<{ resources: Record<string, string> }>({
              type: 'frontend/get_translations',
              language: 'en',
              category: 'issues',
              integrations: domains,
            })
            .catch(() => null);
          if (active && translations) setResources(translations.resources);
        }
      } catch {
        /* Repairs may be unavailable to this user; notifications still work. */
      }
    };
    // Subscribe returns the complete current set, closing the get/subscribe race.
    void api
      .subscribe<{ type: string; notifications: Record<string, PersistentNotice> }>(
        { type: 'persistent_notification/subscribe' },
        (event) => {
          if (active) setPersistent((old) => applyNotificationUpdate(old, event));
        },
      )
      .then((cleanup) => {
        if (active) off = cleanup;
        else cleanup();
      })
      .catch(async () => {
        try {
          const current = await api.request<PersistentNotice[]>({
            type: 'persistent_notification/get',
          });
          if (active) setPersistent(current);
        } catch {
          if (active) setError('Notifications could not be loaded. Reconnect to retry.');
        }
      });
    void refreshRepairs();
    const removeEvents = api.onEvent((event) => {
      if (
        event.type === 'ha-event' &&
        event.event.event_type === 'repairs_issue_registry_updated'
      ) {
        clearTimeout(repairTimer);
        repairTimer = setTimeout(() => void refreshRepairs(), 200);
      }
    });
    const timer = setInterval(() => {
      void refreshRepairs();
    }, 60000);
    return () => {
      active = false;
      off?.();
      removeEvents();
      clearTimeout(repairTimer);
      clearInterval(timer);
    };
  }, [connected, scope]);
  const notifications = useMemo(
    () => homeNotifications(snapshot.states, persistent, repairs, resources),
    [snapshot.states, persistent, repairs, resources],
  );
  const dismiss = async (notificationId: string) => {
    const old = persistent;
    setPersistent((items) => items.filter((item) => item.notification_id !== notificationId));
    try {
      await window.hausNative?.request({
        type: 'call_service',
        domain: 'persistent_notification',
        service: 'dismiss',
        service_data: { notification_id: notificationId },
      });
    } catch (reason) {
      setPersistent((current) =>
        current.some((item) => item.notification_id === notificationId)
          ? current
          : [...current, ...old.filter((item) => item.notification_id === notificationId)],
      );
      throw reason;
    }
  };
  return { notifications, dismiss, error };
}
