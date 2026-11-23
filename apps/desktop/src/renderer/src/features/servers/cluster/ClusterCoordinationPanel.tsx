/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useState } from 'react';
import { Box, HausButton, Heading, SelectInput, Text } from '@haus/ui';
import { ArrowRightLeft, Layers, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  serverRequest,
  type ClusterStatus,
  type ClusterTransferSummary,
  type ClusterWorkloadSummary,
} from '../server-api';
import { clusterErrorMessage } from './errors';

interface WorkloadsResponse {
  readonly workloads: ClusterWorkloadSummary[];
  readonly epoch: number;
  readonly coordinatorId?: string;
  readonly hubId?: string;
  readonly role: string;
}

interface ReconcileResponse {
  readonly reconciled?: boolean;
  readonly converged?: boolean;
  readonly epoch?: number;
  readonly winningEpoch?: number;
  readonly coordinatorId?: string;
  readonly winningCoordinatorId?: string;
  readonly role?: string;
  readonly stoppedWorkloads?: number;
  readonly fencedLocalCount?: number;
  readonly fencedRemoteCount?: number;
  readonly conflictingCoordinators?: readonly string[];
  readonly resolvedConflicts?: readonly { readonly fencedHubIds: readonly string[] }[];
}

export function ClusterCoordinationPanel({
  cluster,
  admin,
  busy,
  act,
}: {
  cluster: ClusterStatus;
  admin: boolean;
  busy: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [workloads, setWorkloads] = useState<ClusterWorkloadSummary[]>();
  const [meta, setMeta] = useState<{ epoch: number; coordinatorId?: string; role: string }>();
  const [loadingWorkloads, setLoadingWorkloads] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [transferTargetId, setTransferTargetId] = useState('');

  const clusterCoordinatorId = meta?.coordinatorId ?? cluster.coordinatorId ?? cluster.id;
  const nodes = Array.isArray(cluster.nodes) ? cluster.nodes : [];
  const coordinatorCandidates = nodes.filter(
    (node) => node.enabled && node.id !== clusterCoordinatorId,
  );
  const isSoleHub = coordinatorCandidates.length === 0;
  const selectedTarget =
    coordinatorCandidates.find((node) => node.id === transferTargetId)?.id ??
    coordinatorCandidates[0]?.id ??
    '';

  const loadWorkloads = useCallback(async () => {
    setLoadingWorkloads(true);
    setErrorMessage('');
    try {
      const response = await serverRequest<WorkloadsResponse>('GET', '/api/cluster/workloads');
      setWorkloads(response.workloads);
      setMeta({
        epoch: response.epoch,
        coordinatorId: response.coordinatorId ?? response.hubId,
        role: response.role,
      });
    } catch (error) {
      setErrorMessage(clusterErrorMessage(error, 'Could not load cluster workloads.'));
    } finally {
      setLoadingWorkloads(false);
    }
  }, []);

  const handleRebalance = () => {
    setStatusMessage('');
    setErrorMessage('');
    void act(async () => {
      const result = await serverRequest<{
        rebalanced?: boolean;
        movedCount?: number;
        movedWorkloadIds?: readonly string[];
        workloads: ClusterWorkloadSummary[];
      }>('POST', '/api/cluster/rebalance', {});
      const moved = result.movedCount ?? result.movedWorkloadIds?.length ?? 0;
      setWorkloads(result.workloads);
      setStatusMessage(
        moved > 0
          ? `Rebalanced ${moved} workload${moved === 1 ? '' : 's'} with fence-before-promote.`
          : 'Workloads are already balanced across healthy Hubs.',
      );
    }).catch((error: unknown) => {
      setErrorMessage(clusterErrorMessage(error, 'Cluster rebalance failed.'));
    });
  };

  const handleReconcile = () => {
    setStatusMessage('');
    setErrorMessage('');
    void act(async () => {
      const result = await serverRequest<ReconcileResponse>('POST', '/api/cluster/reconcile', {});
      const epoch = result.epoch ?? result.winningEpoch ?? cluster.epoch ?? 1;
      const coordinatorId =
        result.coordinatorId ?? result.winningCoordinatorId ?? clusterCoordinatorId;
      const stopped =
        result.stoppedWorkloads ?? (result.fencedLocalCount ?? 0) + (result.fencedRemoteCount ?? 0);
      const conflicts =
        result.conflictingCoordinators ??
        result.resolvedConflicts?.flatMap((item) => item.fencedHubIds) ??
        [];
      setMeta({
        epoch,
        coordinatorId,
        role: result.role ?? cluster.role ?? 'coordinator',
      });
      setStatusMessage(
        `Reconciled at epoch ${epoch}: stopped ${stopped} duplicate workload(s), fenced ${conflicts.length} conflicting coordinator(s).`,
      );
      await loadWorkloads();
    }).catch((error: unknown) => {
      setErrorMessage(clusterErrorMessage(error, 'Cluster reconciliation failed.'));
    });
  };

  const handleTransfer = () => {
    if (!selectedTarget) return;
    setStatusMessage('');
    setErrorMessage('');
    void act(async () => {
      const initiated = await serverRequest<ClusterTransferSummary>(
        'POST',
        '/api/cluster/transfer/initiate',
        { targetHubId: selectedTarget, preservePairing: true },
      );
      try {
        await serverRequest('POST', `/api/cluster/transfer/${initiated.transferId}/prepare`, {});
        await serverRequest('POST', `/api/cluster/transfer/${initiated.transferId}/fence`, {});
        const committed = await serverRequest<{ newCoordinator: string; epoch: number }>(
          'POST',
          `/api/cluster/transfer/${initiated.transferId}/commit`,
          {},
        );
        setStatusMessage(
          `Coordinator transferred to ${committed.newCoordinator} (epoch ${committed.epoch}).`,
        );
        await loadWorkloads();
      } catch (err) {
        await serverRequest('POST', `/api/cluster/transfer/${initiated.transferId}/rollback`, {
          reason: err instanceof Error ? err.message : 'desktop_transfer_aborted',
        }).catch(() => {});
        throw err;
      }
    }).catch((error: unknown) => {
      setErrorMessage(clusterErrorMessage(error, 'Coordinator transfer failed.'));
    });
  };

  const effectiveRole = meta?.role ?? cluster.role ?? 'coordinator';
  const effectiveEpoch = meta?.epoch ?? cluster.epoch ?? 1;
  const effectiveCoordinator = clusterCoordinatorId;

  return (
    <Box semantic="section" className="server-panel server-backups">
      <Box className="server-section-heading">
        <Box>
          <Heading level={3}>
            <Layers size={19} />
            Cluster orchestration & failover
          </Heading>
          <Text semantic="p">
            Single-active execution ownership for apps, integrations, radios and NVR storage across
            connected Hubs.
          </Text>
        </Box>
      </Box>
      <Text semantic="p" className="server-muted">
        Role: <Text semantic="strong">{effectiveRole}</Text> · Epoch:{' '}
        <Text semantic="strong">{effectiveEpoch}</Text>
        {effectiveCoordinator ? ` · Coordinator: ${effectiveCoordinator}` : ''}
      </Text>
      {isSoleHub && (
        <Text semantic="p" className="server-muted">
          Single-Hub mode active — all workloads run locally. Pair another Hub for failover, load
          distribution, and standby redundancy.
        </Text>
      )}
      {cluster.fenced && (
        <Text semantic="p" className="form-error" role="alert">
          <ShieldAlert size={15} /> This Hub is fenced while a transfer completes.
        </Text>
      )}
      <Box className="server-backup-actions">
        <HausButton
          variant="secondary"
          isDisabled={loadingWorkloads}
          onPress={() => void loadWorkloads()}
        >
          <RefreshCw size={16} />
          {workloads ? 'Refresh workloads' : 'Inspect workloads'}
        </HausButton>
        {admin && (
          <>
            <HausButton
              variant="secondary"
              isDisabled={busy || Boolean(cluster.fenced)}
              onPress={handleRebalance}
            >
              Rebalance load
            </HausButton>
            <HausButton variant="ghost" isDisabled={busy} onPress={handleReconcile}>
              <ShieldAlert size={16} />
              Reconcile split-brain
            </HausButton>
          </>
        )}
      </Box>
      {admin && coordinatorCandidates.length > 0 && (
        <Box className="server-backup-actions">
          <Text semantic="label" className="server-muted">
            Transfer coordinator to:{' '}
            <SelectInput
              ariaLabel="Target coordinator Hub"
              value={selectedTarget}
              onChange={setTransferTargetId}
              options={coordinatorCandidates.map((node) => ({
                value: node.id,
                label: `${node.name} (${node.id})`,
              }))}
            />
          </Text>
          <HausButton
            variant="secondary"
            isDisabled={busy || !selectedTarget || Boolean(cluster.fenced)}
            onPress={handleTransfer}
          >
            <ArrowRightLeft size={16} />
            Transfer leadership
          </HausButton>
        </Box>
      )}
      {statusMessage && (
        <Text semantic="p" role="status">
          {statusMessage}
        </Text>
      )}
      {errorMessage && (
        <Text semantic="p" className="form-error" role="alert">
          {errorMessage}
        </Text>
      )}
      {workloads && workloads.length > 0 && (
        <Box className="server-backup-list">
          {workloads.map((wl) => (
            <Box key={wl.workloadId}>
              <Text>
                <Text semantic="strong">{wl.name}</Text> ({wl.kind}) · owner {wl.ownerHubId}
                {wl.standbyHubIds.length > 0 ? ` · standby ${wl.standbyHubIds.join(', ')}` : ''}
              </Text>
              <Text>
                {wl.state} · gen {wl.generation} · rev {wl.configRevision}/{wl.credentialRevision}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      {workloads && workloads.length === 0 && (
        <Text semantic="p" className="server-muted">
          No replicated apps or integrations registered in the cluster yet.
        </Text>
      )}
    </Box>
  );
}
