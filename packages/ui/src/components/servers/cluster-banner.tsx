/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { insets, pct, px } from '../../ir/geometry.js';
import { HausButton, Heading, Row, SelectInput, Stack, Text } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { OperationProgressPanel } from './operation-progress.js';
import { ServerGlassPanel } from './server-surfaces.js';

export interface ClusterOperationProgressView {
  readonly title: string;
  readonly detail?: string;
  readonly percent: number;
  readonly state: 'running' | 'complete' | 'failed';
  readonly logs: readonly string[];
  readonly onDismiss?: () => void;
}

export interface ClusterMeshMemberItem {
  readonly id: string;
  readonly name: string;
  readonly url?: string;
  readonly role: string;
  readonly online: boolean;
  readonly enabled: boolean;
  readonly isSelf?: boolean;
  readonly isCoordinator?: boolean;
}

export interface ClusterMeshStatusView {
  readonly coordinatorId: string;
  readonly role: string;
  readonly epoch: number;
  readonly fenced?: boolean;
  readonly members: readonly ClusterMeshMemberItem[];
}

export function ClusterMeshBanner({
  cluster,
  canManage,
  busy,
  progress,
  onTransferLeadership,
  onRebalance,
  onReconcile,
}: {
  readonly cluster: ClusterMeshStatusView;
  readonly canManage?: boolean;
  readonly busy?: boolean;
  readonly progress?: ClusterOperationProgressView;
  readonly onTransferLeadership?: (targetHubId: string) => void;
  readonly onRebalance?: () => void;
  readonly onReconcile?: () => void;
}) {
  const candidates = cluster.members.filter(
    (m) => m.enabled && m.online && m.id !== cluster.coordinatorId,
  );
  const [targetId, setTargetId] = useState('');
  const selectedTarget = candidates.find((c) => c.id === targetId)?.id ?? candidates[0]?.id ?? '';
  const coordinatorMember = cluster.members.find((m) => m.id === cluster.coordinatorId);

  return (
    <ServerGlassPanel padding={insets(16, 20)} radius={22}>
      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        <Row align="center" justify="between" gapPx={12} wrap>
          <Row align="center" gapPx={10}>
            <UiIcon name="layers" size={18} />
            <Stack gapPx={2} style={{ layout: { minWidth: px(0) } }}>
              <Heading level={3} size={15} weight={600}>
                {cluster.members.length > 1
                  ? `Home Hub network · ${cluster.members.length} Hubs`
                  : 'Standalone Home Hub'}
              </Heading>
              <Text size={12} tone="muted">
                {`Coordinator: ${coordinatorMember ? `${coordinatorMember.name} (${cluster.coordinatorId})` : cluster.coordinatorId} · Local role: ${cluster.role} · Epoch ${cluster.epoch}`}
              </Text>
            </Stack>
          </Row>

          {canManage && cluster.members.length > 1 && (
            <Row align="center" gapPx={8} wrap>
              {onRebalance && (
                <HausButton
                  id="cluster-rebalance"
                  variant="outline"
                  size="sm"
                  disabled={busy || Boolean(cluster.fenced)}
                  onPress={onRebalance}
                >
                  Rebalance
                </HausButton>
              )}
              {onReconcile && (
                <HausButton
                  id="cluster-reconcile"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onPress={onReconcile}
                >
                  Reconcile
                </HausButton>
              )}
            </Row>
          )}
        </Row>

        {canManage && onTransferLeadership && candidates.length > 0 && (
          <Row align="center" gapPx={10} wrap>
            <Text size={12} tone="muted">
              Transfer coordinator to:
            </Text>
            <SelectInput
              ariaLabel="Target coordinator Hub"
              value={selectedTarget}
              onChange={setTargetId}
              options={candidates.map((node) => ({
                value: node.id,
                label: `${node.name} (${node.id})`,
              }))}
            />
            <HausButton
              id="cluster-transfer-leadership"
              variant="secondary"
              size="sm"
              disabled={busy || !selectedTarget || Boolean(cluster.fenced)}
              onPress={() => onTransferLeadership(selectedTarget)}
            >
              <Row align="center" gapPx={6}>
                <UiIcon name="arrow-left-right" size={14} />
                <Text size={12.5}>Transfer leadership</Text>
              </Row>
            </HausButton>
          </Row>
        )}

        {progress && (
          <OperationProgressPanel
            id="cluster-banner-progress"
            title={progress.title}
            detail={progress.detail}
            percent={progress.percent}
            state={progress.state}
            logs={progress.logs}
            onDismiss={progress.onDismiss}
          />
        )}
      </Stack>
    </ServerGlassPanel>
  );
}
