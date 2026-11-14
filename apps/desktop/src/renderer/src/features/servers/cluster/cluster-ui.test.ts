/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import { HausClient, type ClusterNodeDrainPlan, type ClusterStatus } from '@haus/ha/helper-client';
import { validateServiceOperation } from '@haus/ha/helper-service-validation';
import { clusterErrorMessage } from './errors';

describe('clusterErrorMessage & Hub cluster DTO contracts', () => {
  it('translates Hub cluster safety and security error codes cleanly', () => {
    expect(clusterErrorMessage(new Error('HTTP 409 cannot_remove_sole_hub'))).toContain(
      'only Hub left',
    );
    expect(clusterErrorMessage(new Error('transfer_coordinator_before_removing_self'))).toContain(
      'Transfer coordinator leadership',
    );
    expect(clusterErrorMessage(new Error('undrained_data_requires_force'))).toContain('sole-copy');
    expect(clusterErrorMessage('ssrf_blocked')).toContain('blocked or unsafe address');
    expect(clusterErrorMessage('grant_revoked')).toContain('already been used or revoked');
  });

  it('falls back to serverErrorMessage for non-cluster failures', () => {
    expect(clusterErrorMessage(new Error('Error: not found'))).toContain('Update the Haus helper');
  });

  it('handles Hub-native sole-hub DrainPlan, RebalanceResult, ReconciliationOutcome and /api/cluster/attach validation', async () => {
    expect(
      validateServiceOperation('POST', '/api/cluster/attach', {
        coordinatorUrl: 'http://192.168.5.117:8790',
        selfUrl: 'http://192.168.5.118:8790',
        coordinatorToken: 'tok-123',
        roles: ['storage', 'stream', 'radio'],
        grant: { grantId: 'grant-attach-1', signature: 'ed25519-sig' },
      }),
    ).toBe(true);
    expect(
      validateServiceOperation('POST', '/api/cluster/attach', {
        coordinatorUrl: 'http://192.168.5.117:8790',
        grant: { grantId: 'grant-attach-1' },
        unexpectedShellField: 'bad',
      }),
    ).toBe(false);

    const solePlan: ClusterNodeDrainPlan = {
      nodeId: 'hub-sole',
      isLocalNode: true,
      isSoleHub: true,
      canRemoveSafely: false,
      blockReason: 'cannot_remove_sole_hub',
      online: true,
      soleCopyMediaCount: 0,
      soleCopyMediaBytes: 0,
      soleCopyBackupsCount: 0,
      activeWorkloadIds: ['app:nvr'],
    };

    const statusPayload: ClusterStatus = {
      optional: false,
      id: 'hub-sole',
      role: 'coordinator',
      epoch: 2,
      fenced: false,
      coordinatorId: 'hub-sole',
      nodes: [
        {
          id: 'hub-sole',
          name: 'Sole Hub',
          url: 'http://127.0.0.1:8790',
          roles: ['storage', 'stream'],
          allowHttp: true,
          enabled: true,
          online: true,
          backupCopies: 1,
          livePriority: 100,
        },
      ],
      backups: { items: [], busy: false },
      sync: { enabled: true, authority: 'hub-sole' },
      busy: false,
    };

    const request = vi
      .fn()
      .mockResolvedValueOnce(solePlan)
      .mockResolvedValueOnce({ rebalanced: true, movedCount: 1, workloads: [] })
      .mockResolvedValueOnce({
        reconciled: true,
        epoch: 2,
        coordinatorId: 'hub-sole',
        role: 'coordinator',
        stoppedWorkloads: 0,
        conflictingCoordinators: [],
      })
      .mockResolvedValueOnce(statusPayload);
    const client = new HausClient({ request });

    const plan = await client.drainPlan('hub-sole');
    expect(plan.isSoleHub).toBe(true);
    expect(plan.canRemoveSafely).toBe(false);
    expect(plan.activeWorkloadIds).toEqual(['app:nvr']);

    const rebalanced = await client.rebalanceCluster();
    expect(rebalanced).toMatchObject({ rebalanced: true, movedCount: 1 });

    const reconciled = await client.reconcileCluster();
    expect(reconciled).toMatchObject({ reconciled: true, epoch: 2, coordinatorId: 'hub-sole' });

    const status = await client.cluster();
    expect(status.coordinatorId).toBe('hub-sole');
  });
});
