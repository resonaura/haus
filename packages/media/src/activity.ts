/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';
/** Stable logical camera activity identity, independent of the presentation backend. */
export const activityId = (id: string) =>
  `haus_activity_${createHash('sha256').update(id).digest('hex').slice(0, 20)}`;
