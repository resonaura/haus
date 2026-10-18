import { describe, it, expect } from 'vitest';
import { applyNotificationUpdate, homeNotifications } from './notifications';
import type { HassEntity } from './types';
describe('live home notification feed', () => {
  it('reconciles full notification sets, updates and removals without duplicates', () => {
    const first = applyNotificationUpdate([], {
      type: 'current',
      notifications: { one: { notification_id: 'one', message: 'Hello' } },
    });
    const updated = applyNotificationUpdate(first, {
      type: 'updated',
      notifications: { one: { notification_id: 'one', message: 'Updated' } },
    });
    expect(updated).toHaveLength(1);
    expect(updated[0].message).toBe('Updated');
    expect(
      applyNotificationUpdate(updated, {
        type: 'removed',
        notifications: { one: { notification_id: 'one' } },
      }),
    ).toEqual([]);
  });
  it('combines updates and translated repairs, ignoring dismissed issues and the skipped release only', () => {
    const state = (id: string, skipped?: string): HassEntity => ({
      entity_id: id,
      state: 'on',
      last_changed: '',
      attributes: {
        friendly_name: 'Core',
        installed_version: '1',
        latest_version: '3',
        skipped_version: skipped,
      },
    });
    const notices = homeNotifications(
      [state('update.core', '2'), state('update.skipped', '3')],
      [],
      [
        {
          domain: 'test',
          issue_id: 'missing',
          translation_key: 'missing',
          translation_placeholders: { name: 'Camera' },
          severity: 'critical',
        },
        { domain: 'ignored', issue_id: 'old', ignored: true },
      ],
      { 'component.test.issues.missing.title': '{name} needs attention' },
    );
    expect(notices.map((notice) => notice.id)).toEqual(['repair:test:missing', 'update.core']);
    expect(notices[0].title).toBe('Camera needs attention');
  });
});
