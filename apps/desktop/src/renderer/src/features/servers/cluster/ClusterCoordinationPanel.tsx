/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useState } from 'react';
import { Box, HausButton, Heading, SelectInput, Text } from '@haus/ui';
import { OperationProgressPanel } from '@haus/ui/components';
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
  const [opProgress, setOpProgress] = useState<{
    title: string;
    detail?: string;
    percent: number;
    state: 'running' | 'complete' | 'failed';
    logs: readonly string[];
  }>();

  const clusterCoordinatorId = meta?.coordinatorId ?? cluster.coordinatorId ?? cluster.id;
  const nodes =
    Array.isArray(cluster.members) && cluster.members.length > 0
      ? cluster.members
      : Array.isArray(cluster.nodes)
        ? cluster.nodes
        : [];
  const coordinatorCandidates = nodes.filter(
    (node) => node.enabled && node.online !== false && node.id !== clusterCoordinatorId,
  );
  const isSoleHub =
    nodes.filter((node) => node.enabled).length <= 1 && coordinatorCandidates.length === 0;
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
    const logs = ['[CLUSTER] Evaluating workload placement across healthy Hubs…'];
    setOpProgress({
      title: 'Rebalancing cluster workloads…',
      detail: 'Applying single-active Fence-Before-Promote placement',
      percent: 45,
      state: 'running',
      logs,
    });
    void act(async () => {
      const result = await serverRequest<{
        rebalanced?: boolean;
        movedCount?: number;
        movedWorkloadIds?: readonly string[];
        workloads: ClusterWorkloadSummary[];
      }>('POST', '/api/cluster/rebalance', {});
      const moved = result.movedCount ?? result.movedWorkloadIds?.length ?? 0;
      setWorkloads(result.workloads);
      const msg =
        moved > 0
          ? `Rebalanced ${moved} workload${moved === 1 ? '' : 's'} with fence-before-promote.`
          : 'Workloads are already balanced across healthy Hubs.';
      setStatusMessage(msg);
      setOpProgress({
        title: 'Cluster rebalance complete',
        detail: msg,
        percent: 100,
        state: 'complete',
        logs: [...logs, `[OK] ${msg}`],
      });
    }).catch((error: unknown) => {
      const msg = clusterErrorMessage(error, 'Cluster rebalance failed.');
      setErrorMessage(msg);
      setOpProgress({
        title: 'Cluster rebalance failed',
        detail: msg,
        percent: 100,
        state: 'failed',
        logs: [...logs, `[ERROR] ${msg}`],
      });
    });
  };

  const handleReconcile = () => {
    setStatusMessage('');
    setErrorMessage('');
    const logs = ['[CLUSTER] Checking monotonic epoch & single-writer ownership across peers…'];
    setOpProgress({
      title: 'Reconciling split-brain state…',
      detail: 'Verifying coordinator epoch & fencing stale writers',
      percent: 50,
      state: 'running',
      logs,
    });
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
      const msg = `Reconciled at epoch ${epoch}: stopped ${stopped} duplicate workload(s), fenced ${conflicts.length} conflicting coordinator(s).`;
      setStatusMessage(msg);
      setOpProgress({
        title: 'Cluster reconciliation complete',
        detail: msg,
        percent: 100,
        state: 'complete',
        logs: [...logs, `[OK] ${msg}`],
      });
      await loadWorkloads();
    }).catch((error: unknown) => {
      const msg = clusterErrorMessage(error, 'Cluster reconciliation failed.');
      setErrorMessage(msg);
      setOpProgress({
        title: 'Cluster reconciliation failed',
        detail: msg,
        percent: 100,
        state: 'failed',
        logs: [...logs, `[ERROR] ${msg}`],
      });
    });
  };

  const handleTransfer = () => {
    if (!selectedTarget) return;
    setStatusMessage('');
    setErrorMessage('');
    const logs: string[] = [`[CLUSTER] Initiating leadership handover to ${selectedTarget}…`];
    setOpProgress({
      title: `Transferring coordinator to ${selectedTarget}…`,
      detail: 'Step 1/4 · Initiating transfer intent',
      percent: 20,
      state: 'running',
      logs: [...logs],
    });
    void act(async () => {
      const initiated = await serverRequest<ClusterTransferSummary>(
        'POST',
        '/api/cluster/transfer/initiate',
        { targetHubId: selectedTarget, preservePairing: true },
      );
      logs.push(
        `[INFO] Transfer ${initiated.transferId} created; staging state & credential manifest…`,
      );
      setOpProgress({
        title: `Transferring coordinator to ${selectedTarget}…`,
        detail: 'Step 2/4 · Preparing home manifest & encrypted credentials',
        percent: 48,
        state: 'running',
        logs: [...logs],
      });
      try {
        await serverRequest('POST', `/api/cluster/transfer/${initiated.transferId}/prepare`, {});
        logs.push('[SYNC] Manifest verified by target Hub; fencing outgoing coordinator…');
        setOpProgress({
          title: `Transferring coordinator to ${selectedTarget}…`,
          detail: 'Step 3/4 · Fencing previous coordinator (single-writer safety)',
          percent: 76,
          state: 'running',
          logs: [...logs],
        });
        await serverRequest('POST', `/api/cluster/transfer/${initiated.transferId}/fence`, {});
        logs.push('[CLUSTER] Outgoing coordinator fenced; committing new epoch & renewing leases…');
        const committed = await serverRequest<{ newCoordinator: string; epoch: number }>(
          'POST',
          `/api/cluster/transfer/${initiated.transferId}/commit`,
          {},
        );
        const msg = `Coordinator transferred to ${committed.newCoordinator} (epoch ${committed.epoch}).`;
        logs.push(`[OK] ${msg}`);
        setStatusMessage(msg);
        setOpProgress({
          title: 'Leadership transfer complete',
          detail: msg,
          percent: 100,
          state: 'complete',
          logs: [...logs],
        });
        await loadWorkloads();
      } catch (err) {
        logs.push('[WARN] Rolling back incomplete transfer and restoring active leases…');
        await serverRequest('POST', `/api/cluster/transfer/${initiated.transferId}/rollback`, {
          reason: err instanceof Error ? err.message : 'desktop_transfer_aborted',
        }).catch(() => {});
        throw err;
      }
    }).catch((error: unknown) => {
      const msg = clusterErrorMessage(error, 'Coordinator transfer failed.');
      logs.push(`[ERROR] ${msg}`);
      setErrorMessage(msg);
      setOpProgress({
        title: 'Leadership transfer failed',
        detail: msg,
        percent: 100,
        state: 'failed',
        logs: [...logs],
      });
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
      {opProgress && (
        <OperationProgressPanel
          id="cluster-operation-progress"
          title={opProgress.title}
          detail={opProgress.detail}
          percent={opProgress.percent}
          state={opProgress.state}
          logs={opProgress.logs}
          onDismiss={opProgress.state !== 'running' ? () => setOpProgress(undefined) : undefined}
        />
      )}
      {statusMessage && !opProgress && (
        <Text semantic="p" role="status">
          {statusMessage}
        </Text>
      )}
      {errorMessage && !opProgress && (
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
