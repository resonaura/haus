/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import type {
  ServerDetailTabId,
  ServerIdentityPatch,
  ServerKind,
  ServerRoomOption,
  ServerServiceRow,
  ServerSummaryRecord,
} from '@haus/core/transport';
import { ClusterMeshBanner, type ClusterMeshStatusView } from './cluster-banner.js';
import {
  AddClusterHubModal,
  type AddClusterHubSubmitInput,
  type AddClusterHubSubmitResult,
  type DiscoveredClusterHubCandidate,
} from './cluster-modal.js';
import { ServerOptionsDialog } from './parts/server-options-dialog.js';
import { useServersWorkspaceController } from './parts/use-servers-workspace.js';
import { ServerDetailView } from './server-detail.js';
import { ServersOverviewView } from './servers-overview.js';

export interface ServerDevicePreferenceInput {
  readonly name?: string;
  readonly areaId?: string;
  readonly icon?: string;
  readonly favorite?: boolean;
  readonly hidden?: boolean;
}

export interface PortableServersManagementPort {
  loadServers(): Promise<ServerSummaryRecord[]>;
  setServerEnabled(serverId: string, enabled: boolean): Promise<void>;
  setStorageLimit?(serverId: string, local: boolean, limitBytes: number | null): Promise<void>;
  removeServer?(serverId: string, kind: ServerKind): Promise<void>;
  loadCluster?(): Promise<ClusterMeshStatusView | undefined>;
  transferLeadership?(targetHubId: string): Promise<void>;
  rebalanceCluster?(): Promise<void>;
  reconcileCluster?(): Promise<void>;
  discoverCandidateHubs?(): Promise<DiscoveredClusterHubCandidate[]>;
  enrollHub?(input: AddClusterHubSubmitInput): Promise<AddClusterHubSubmitResult>;
}

export interface ActiveServerSelection {
  readonly server: ServerSummaryRecord;
  readonly activeTab: ServerDetailTabId;
  readonly onSelectTab: (tab: ServerDetailTabId) => void;
  readonly onBack: () => void;
}

export function ServersManagementWorkspace({
  columns = 3,
  demo = false,
  canManage = false,
  contextualNavigation = false,
  rooms = [],
  roomIcons,
  serverPreferences = {},
  port,
  renderLogs,
  renderTerminal,
  onSaveServerPreference,
  onOpenRoom,
  onServerContextMenu,
  onInspectService,
  onActiveServerChange,
  onSaved,
}: {
  readonly columns?: number;
  readonly demo?: boolean;
  readonly canManage?: boolean;
  readonly contextualNavigation?: boolean;
  readonly rooms?: readonly ServerRoomOption[];
  readonly roomIcons?: Readonly<Record<string, string>>;
  readonly serverPreferences?: Readonly<Record<string, ServerDevicePreferenceInput | undefined>>;
  readonly port?: PortableServersManagementPort;
  readonly renderLogs?: (server: ServerSummaryRecord, demoLogs?: string) => ReactNode;
  readonly renderTerminal?: (server: ServerSummaryRecord) => ReactNode;
  readonly onSaveServerPreference?: (
    serverId: string,
    next: ServerIdentityPatch,
  ) => void | Promise<void>;
  readonly onOpenRoom?: (roomId: string) => void;
  readonly onServerContextMenu?: (server: ServerSummaryRecord) => void;
  readonly onInspectService?: (
    server: ServerSummaryRecord,
    service: ServerServiceRow,
    mode: 'logs' | 'terminal',
  ) => void;
  readonly onActiveServerChange?: (selection: ActiveServerSelection | undefined) => void;
  readonly onSaved?: () => void;
}) {
  const ctl = useServersWorkspaceController({
    demo,
    rooms,
    serverPreferences,
    port,
    onActiveServerChange,
  });

  const clusterBanner = ctl.cluster ? (
    <ClusterMeshBanner
      cluster={ctl.cluster}
      canManage={canManage}
      busy={ctl.busy}
      progress={ctl.clusterProgress}
      onTransferLeadership={
        port?.transferLeadership
          ? (targetHubId) =>
              ctl.runClusterAction(
                `Transferring leadership to ${targetHubId}…`,
                () => port.transferLeadership!(targetHubId),
                `Coordinator transferred to ${targetHubId}.`,
              )
          : undefined
      }
      onRebalance={
        port?.rebalanceCluster
          ? () =>
              ctl.runClusterAction(
                'Rebalancing cluster workloads…',
                () => port.rebalanceCluster!(),
                'Cluster workloads rebalanced.',
              )
          : undefined
      }
      onReconcile={
        port?.reconcileCluster
          ? () =>
              ctl.runClusterAction(
                'Reconciling split-brain claims…',
                () => port.reconcileCluster!(),
                'Split-brain claims reconciled.',
              )
          : undefined
      }
    />
  ) : undefined;

  if (ctl.selectedServer) {
    const selectedServer = ctl.selectedServer;
    const targetId = selectedServer.managedId ?? selectedServer.id;
    return (
      <ServerDetailView
        server={selectedServer}
        history={ctl.historyByServer[selectedServer.id] ?? []}
        rooms={rooms}
        activeTab={ctl.activeTab}
        canManage={canManage}
        contextualNavigation={contextualNavigation}
        busy={ctl.busy}
        error={ctl.error || undefined}
        logsSlot={
          ctl.activeTab === 'logs'
            ? renderLogs?.(selectedServer, ctl.demoInitial?.logsByServerId[selectedServer.id])
            : undefined
        }
        terminalSlot={ctl.activeTab === 'terminal' ? renderTerminal?.(selectedServer) : undefined}
        backupsSlot={clusterBanner}
        onInspectService={
          onInspectService
            ? (service, mode) => onInspectService(selectedServer, service, mode)
            : undefined
        }
        onSelectTab={ctl.handleSelectTab}
        onBack={ctl.handleBack}
        onSaveIdentity={
          onSaveServerPreference
            ? (patch) => {
                if (demo) {
                  ctl.setRawServers((prev) =>
                    prev.map((s) =>
                      s.id === selectedServer.id
                        ? {
                            ...s,
                            name: patch.name,
                            roomId: patch.areaId,
                            roomName: rooms.find((r) => r.id === patch.areaId)?.name,
                            icon: patch.icon,
                          }
                        : s,
                    ),
                  );
                }
                return onSaveServerPreference(selectedServer.id, patch);
              }
            : undefined
        }
        onSaveStorageLimit={
          demo || port?.setStorageLimit
            ? async (limitBytes) => {
                if (demo) {
                  ctl.setRawServers((prev) =>
                    prev.map((s) =>
                      s.id === selectedServer.id && s.nvr
                        ? { ...s, nvr: { ...s.nvr, limitBytes } }
                        : s,
                    ),
                  );
                  return;
                }
                if (!port?.setStorageLimit) return;
                ctl.setBusy(true);
                ctl.setError('');
                try {
                  await port.setStorageLimit(targetId, Boolean(selectedServer.local), limitBytes);
                  onSaved?.();
                  await ctl.loadServers(true);
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : 'Could not save storage limit.';
                  ctl.setError(msg);
                  throw err;
                } finally {
                  ctl.setBusy(false);
                }
              }
            : undefined
        }
        onToggleEnabled={() => {
          if (demo) {
            ctl.setRawServers((prev) =>
              prev.map((item) =>
                item.id === selectedServer.id ? { ...item, enabled: !item.enabled } : item,
              ),
            );
            return;
          }
          if (!port) return;
          ctl.setBusy(true);
          ctl.setError('');
          void port
            .setServerEnabled(targetId, !selectedServer.enabled)
            .then(() => {
              onSaved?.();
              return ctl.loadServers(true);
            })
            .catch((err: unknown) => {
              ctl.setError(err instanceof Error ? err.message : 'Could not update server.');
            })
            .finally(() => ctl.setBusy(false));
        }}
        onRemoveServer={
          !selectedServer.local && (demo || port?.removeServer)
            ? async () => {
                if (demo) {
                  ctl.setRawServers((prev) => prev.filter((item) => item.id !== selectedServer.id));
                  ctl.handleBack();
                  return;
                }
                if (!port?.removeServer) return;
                await port.removeServer(targetId, selectedServer.kind);
                onSaved?.();
                ctl.handleBack();
                await ctl.loadServers(true);
              }
            : undefined
        }
      />
    );
  }

  return (
    <>
      <ServersOverviewView
        columns={columns}
        servers={ctl.servers}
        roomIcons={roomIcons}
        loading={ctl.loading}
        error={ctl.error || undefined}
        notice={ctl.notice || undefined}
        canManage={canManage}
        clusterSlot={clusterBanner}
        onAddHub={
          !demo && port?.enrollHub
            ? () => {
                ctl.setAddHubOpen(true);
                ctl.scanHubs();
              }
            : undefined
        }
        onOpenRoom={onOpenRoom}
        onServerContextMenu={
          onServerContextMenu ??
          (onSaveServerPreference ? (target) => ctl.setOptionsServer(target) : undefined)
        }
        onRefresh={() => {
          ctl.setNotice('');
          void ctl.loadServers(false);
        }}
        onSelectServer={(id) => {
          ctl.setError('');
          ctl.setNotice('');
          ctl.setSelectedId(id);
          ctl.setActiveTab('overview');
        }}
      />
      {ctl.optionsServer && onSaveServerPreference && (
        <ServerOptionsDialog
          server={ctl.optionsServer}
          canManage={canManage}
          onClose={() => ctl.setOptionsServer(undefined)}
          onOpenTab={(id, tab) => {
            ctl.setSelectedId(id);
            ctl.setActiveTab(tab);
          }}
          onSavePreference={onSaveServerPreference}
        />
      )}
      {port?.enrollHub && (
        <AddClusterHubModal
          open={ctl.addHubOpen}
          candidates={ctl.candidateHubs}
          scanning={ctl.scanningHubs}
          onRescan={ctl.scanHubs}
          onSubmit={async (input) => {
            const res = await port.enrollHub!(input);
            if (res.status === 'joined') {
              ctl.setNotice(`Added ${res.hubName ?? 'Hub'} to your Home network.`);
              await ctl.loadServers(true);
            }
            return res;
          }}
          onClose={() => ctl.setAddHubOpen(false)}
        />
      )}
    </>
  );
}
