/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export { activityId as activityKey } from '@haus/media/activity';
export const isHausActivity = (state, entry) =>
  (entry?.platform === 'mqtt' && /^haus_activity_[a-f0-9]{20}$/.test(entry.unique_id ?? '')) ||
  (state?.attributes?.haus_activity_version === 1 &&
    /^camera\.[a-z0-9_]+$/.test(state.attributes.haus_camera ?? ''));
