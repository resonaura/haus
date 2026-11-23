/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Box, CheckboxInput, HausButton, Text } from '@haus/ui';
import { Dialog } from '../../../components/ui/Dialog';
import { serverRequest, type ClusterNodeDrainPlan } from '../server-api';
import { serverManagementId } from '../server-connections';
import type { HomeServer } from '../types';
import { bytes as formatBytes } from '../presentation';
import { clusterErrorMessage } from './errors';

export function RemoveServerDialog({
  removing,
  busy,
  fresh,
  act,
  onClose,
  onRemoved,
  onServerDeviceChange,
  onRefresh,
}: {
  removing: HomeServer;
  busy: boolean;
  fresh: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
  onRemoved: (clearSelection?: boolean) => void;
  onServerDeviceChange?: (id: string, value: Record<string, never>) => void | Promise<void>;
  onRefresh: () => Promise<unknown>;
}) {
  const [removingBusy, setRemovingBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [drainPlan, setDrainPlan] = useState<ClusterNodeDrainPlan>();
  const [planLoading, setPlanLoading] = useState(false);
  const [allowForceOffline, setAllowForceOffline] = useState(false);

  const managedId = serverManagementId(removing);
  const isManagedHub = removing.kind !== 'ssh';

  useEffect(() => {
    setRemoveError('');
    setAllowForceOffline(false);
    setDrainPlan(undefined);
    if (!isManagedHub) return;
    let active = true;
    setPlanLoading(true);
    void serverRequest<ClusterNodeDrainPlan>('GET', `/api/cluster/nodes/${managedId}/drain-plan`)
      .then((plan) => {
        if (active) setDrainPlan(plan);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setPlanLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isManagedHub, managedId]);

  const blockedReason =
    drainPlan?.blockReason ??
    (drainPlan?.isSoleHub
      ? 'cannot_remove_sole_hub'
      : drainPlan?.isLocalNode
        ? 'transfer_coordinator_before_removing_self'
        : undefined);
  const workloadsCount =
    drainPlan?.workloadsToMigrate?.length ?? drainPlan?.activeWorkloadIds?.length ?? 0;
  const exclusiveRadios = drainPlan?.exclusiveRadios ?? drainPlan?.soleRadioWarnings ?? [];
  const needsForce =
    Boolean(drainPlan?.requiresForceIfOffline ?? drainPlan?.requiresForce) ||
    exclusiveRadios.length > 0 ||
    removeError.includes('sole-copy') ||
    removeError.includes('undrained');

  const handleSshRemove = async () => {
    setRemovingBusy(true);
    setRemoveError('');
    try {
      if (!window.hausNative?.serverSshRemove)
        throw new Error('Restart Haus to enable SSH server management.');
      if (removing.managedId)
        await serverRequest('POST', `/api/cluster/nodes/${removing.managedId}/remove`, {});
      await window.hausNative.serverSshRemove(removing.id);
      await onServerDeviceChange?.(removing.id, {});
      onRemoved(true);
      await onRefresh();
    } catch {
      setRemoveError('The SSH connection could not be removed. Try again.');
    } finally {
      setRemovingBusy(false);
    }
  };

  const handleHubRemove = () => {
    setRemoveError('');
    void act(async () => {
      if (
        !allowForceOffline &&
        drainPlan &&
        (workloadsCount > 0 ||
          drainPlan.soleCopyMediaCount > 0 ||
          drainPlan.soleCopyBackupsCount > 0)
      ) {
        await serverRequest('POST', `/api/cluster/nodes/${managedId}/drain`, {});
      }
      await serverRequest(
        'POST',
        `/api/cluster/nodes/${managedId}/remove`,
        allowForceOffline ? { force: true } : {},
      );
      onRemoved(false);
    }).catch((error: unknown) => {
      setRemoveError(clusterErrorMessage(error, 'Failed to remove Hub from cluster.'));
    });
  };

  return (
    <Dialog
      title={removing.kind === 'ssh' ? `Remove ${removing.name}` : `Disconnect ${removing.name}`}
      onClose={() => !busy && !removingBusy && onClose()}
    >
      {removeError && (
        <Text semantic="p" className="form-error" role="alert">
          {removeError}
        </Text>
      )}
      <Text semantic="p" className="registry-help">
        {removing.kind === 'ssh' && removing.managedId
          ? 'This removes the saved SSH credentials and the Haus connection. The server’s services and files stay on disk.'
          : removing.kind === 'ssh'
            ? 'This removes the saved SSH connection and its protected credentials from Haus. It does not change the server or any files on it.'
            : 'Haus migrates active apps, integrations and sole-copy NVR media/backups before unlinking this Hub. Local files already written stay on disk.'}
      </Text>
      {isManagedHub && planLoading && (
        <Text semantic="p" className="server-muted">
          Checking sole-copy media and workloads…
        </Text>
      )}
      {isManagedHub && drainPlan && (
        <Box className="server-notice" role="status">
          <Box>
            <Text semantic="strong">Drain summary ({drainPlan.online ? 'online' : 'offline'})</Text>
            <Text semantic="p">
              Workloads to migrate: {workloadsCount} · Sole-copy NVR clips:{' '}
              {drainPlan.soleCopyMediaCount} ({formatBytes(drainPlan.soleCopyMediaBytes)}) ·
              Sole-copy backups: {drainPlan.soleCopyBackupsCount}
            </Text>
            {exclusiveRadios.length > 0 && (
              <Text semantic="p">Exclusive radios on this Hub: {exclusiveRadios.join(', ')}</Text>
            )}
            {blockedReason && (
              <Text semantic="p" className="form-error">
                {clusterErrorMessage(blockedReason)}
              </Text>
            )}
          </Box>
        </Box>
      )}
      {isManagedHub && needsForce && !blockedReason && (
        <Text semantic="label" className="server-muted">
          <CheckboxInput checked={allowForceOffline} onChange={setAllowForceOffline} /> Force unlink
          even though unreachable sole-copy data on this Hub cannot be evacuated
        </Text>
      )}
      <Box className="registry-dialog-actions">
        <HausButton variant="ghost" isDisabled={busy || removingBusy} onPress={onClose}>
          Keep connected
        </HausButton>
        <HausButton
          variant="danger"
          isPending={busy || removingBusy || planLoading}
          isDisabled={
            removing.kind !== 'ssh' &&
            (!fresh ||
              Boolean(blockedReason) ||
              (Boolean(drainPlan?.requiresForceIfOffline) && !allowForceOffline))
          }
          onPress={() => (removing.kind === 'ssh' ? void handleSshRemove() : handleHubRemove())}
        >
          {removing.kind === 'ssh'
            ? 'Remove SSH server'
            : allowForceOffline
              ? 'Force disconnect Hub'
              : 'Drain & disconnect Hub'}
        </HausButton>
      </Box>
    </Dialog>
  );
}
