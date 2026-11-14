/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { serverErrorMessage } from '../server-errors';

const CLUSTER_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  cannot_remove_sole_hub:
    'This is the only Hub left in the home. Pair and transfer coordinator duties to another Hub before unlinking it.',
  transfer_coordinator_before_removing_self:
    'This Hub is currently the home coordinator. Transfer coordinator leadership to another healthy Hub before removing it.',
  undrained_data_requires_force:
    'This Hub still holds sole-copy recordings or backups that have not been evacuated. Drain while it is online, or confirm force removal.',
  drain_incomplete:
    'Not all sole-copy recordings or backups could be evacuated to other Hubs. Retry once a healthy storage Hub is reachable.',
  coordinator_fenced: 'Coordinator mutations are paused while a Hub transfer is in progress.',
  transfer_in_progress: 'Another Hub-to-Hub transfer is already active.',
  ssrf_blocked: 'The target Hub URL points to a blocked or unsafe address.',
  invalid_pairing_grant:
    'A valid single-use pairing grant from the admin is required to join the cluster.',
  grant_revoked:
    'This pairing grant has already been used or revoked. Generate a fresh pairing code.',
};

export function clusterErrorMessage(error: unknown, fallback?: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  for (const [code, message] of Object.entries(CLUSTER_ERROR_MESSAGES)) {
    if (raw.includes(code)) return message;
  }
  const translated = serverErrorMessage(error, { serverApi: true });
  return translated === 'This request could not be completed.' && fallback ? fallback : translated;
}
