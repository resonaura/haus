/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { FlowProgress, IntegrationEntry } from '../../ha/management';
export const attentionFlow = (entry: IntegrationEntry, progress: FlowProgress[]) =>
  progress.find(
    (flow) =>
      flow.handler === entry.domain &&
      flow.context?.entry_id === entry.entry_id &&
      ['reauth', 'reconfigure'].includes(flow.context.source ?? ''),
  );
export const entryNeedsAttention = (entry: IntegrationEntry, progress: FlowProgress[] = []) =>
  !entry.disabled_by &&
  (['setup_error', 'migration_error', 'setup_retry', 'failed_unload'].includes(entry.state) ||
    Boolean(attentionFlow(entry, progress)));
