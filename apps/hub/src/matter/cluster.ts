/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ClusterLeaseService } from '../cluster/coordination/leases.js';

export const MATTER_WORKLOAD_ID = 'integration:matter:default';

/** Registers the Matter Controller under single-active cluster lease coordination. */
export async function ensureMatterClusterLease(params: {
  readonly leaseService?: ClusterLeaseService;
  readonly getLocalStatus: () => 'running' | 'stopped';
  readonly startLocal: () => Promise<void>;
  readonly stopLocal: () => Promise<void>;
}): Promise<boolean> {
  if (!params.leaseService) return true;
  params.leaseService.registerWorkloadController(MATTER_WORKLOAD_ID, {
    kind: 'integration',
    name: 'Matter Controller',
    requirements: { requiredRadio: 'matter' },
    getLocalStatus: params.getLocalStatus,
    startLocal: params.startLocal,
    stopLocal: params.stopLocal,
  });
  await params.leaseService.ensureLocalOwnership({
    workloadId: MATTER_WORKLOAD_ID,
    kind: 'integration',
    name: 'Matter Controller',
    requirements: { requiredRadio: 'matter' },
  });
  return params.leaseService.shouldRunLocally(MATTER_WORKLOAD_ID);
}
