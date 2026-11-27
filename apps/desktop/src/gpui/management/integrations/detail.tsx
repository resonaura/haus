/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  filterIssuesForDomain,
  formatIotClass,
  formatRuntimeLabel,
  integrationFamilyKey,
  type DiscoveredFlowItem,
  type IntegrationDomainMetaRecord,
  type IntegrationGroupSummary,
  type RepairIssueRecord,
  type UnifiedUpdateRecord,
  type UnifiedUpdatesSummary,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import { IntegrationDetailsView, type PortableDiscoveredFlow } from '@haus/ui/components';
import type { homeDashboard } from '../../home/model.js';
import type { GpuiAddDeviceRequest } from '../add-device.js';
import { buildGpuiEntryDetails, runtimeIconKind } from './helpers.js';

export function GpuiIntegrationDetailView({
  group,
  meta,
  snapshot,
  home,
  progressFlows,
  issues,
  allDiscovered,
  updates,
  installingId,
  canManage,
  hasHacs,
  busy,
  error,
  notice,
  onBack,
  onAddDevice,
  onReloadEntry,
  onToggleDisabled,
  onDeleteEntry,
  onFixRepair,
  onToggleIgnoreRepair,
  onInstallUpdate,
  onOpenHacs,
  onOpenExternal,
  onOpenEntity,
}: {
  readonly group: IntegrationGroupSummary;
  readonly meta?: IntegrationDomainMetaRecord;
  readonly snapshot: Snapshot;
  readonly home: ReturnType<typeof homeDashboard>;
  readonly progressFlows: readonly DiscoveredFlowItem[];
  readonly issues: readonly RepairIssueRecord[];
  readonly allDiscovered: readonly PortableDiscoveredFlow[];
  readonly updates: UnifiedUpdatesSummary | null;
  readonly installingId: string | null;
  readonly canManage: boolean;
  readonly hasHacs: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly onBack: () => void;
  readonly onAddDevice?: (request?: GpuiAddDeviceRequest) => void;
  readonly onReloadEntry: (entryId: string) => void;
  readonly onToggleDisabled: (entryId: string, disabled: boolean) => void;
  readonly onDeleteEntry: (entryId: string) => void;
  readonly onFixRepair?: (issue: RepairIssueRecord) => void;
  readonly onToggleIgnoreRepair: (issue: RepairIssueRecord, ignore: boolean) => void;
  readonly onInstallUpdate: (item: UnifiedUpdateRecord) => void;
  readonly onOpenHacs: () => void;
  readonly onOpenExternal?: (url: string) => void;
  readonly onOpenEntity?: (entityId: string) => void;
}) {
  const entryDetails = buildGpuiEntryDetails(group.entries, progressFlows, snapshot);
  const domainIssues = filterIssuesForDomain(issues, group.domain);
  const domainDiscovered = allDiscovered.filter(
    (item) => integrationFamilyKey(item.handler) === group.domain,
  );
  const domainUpdate = updates?.items.find((u) => integrationFamilyKey(u.domain) === group.domain);
  const totalDevices =
    meta?.deviceCount ?? entryDetails.reduce((acc, e) => acc + e.devices.length, 0);
  const totalEntities =
    meta?.entityCount ??
    entryDetails.reduce(
      (acc, e) => acc + e.devices.reduce((sum, d) => sum + (d.entityCount ?? 0), 0),
      0,
    );

  return (
    <IntegrationDetailsView
      domain={group.domain}
      iconKind={runtimeIconKind(meta?.runtimeType)}
      title={group.name}
      runtimeLabel={formatRuntimeLabel(meta?.runtimeType)}
      iotClassLabel={formatIotClass(meta?.iotClass)}
      version={meta?.version}
      documentationUrl={
        meta?.documentationUrl ?? `https://www.home-assistant.io/integrations/${group.domain}`
      }
      deviceCount={totalDevices}
      entityCount={totalEntities}
      entries={entryDetails}
      issues={domainIssues}
      discovered={domainDiscovered}
      updateItem={domainUpdate}
      installingUpdateId={installingId}
      canManage={canManage}
      busy={busy}
      error={error}
      notice={notice}
      onBack={onBack}
      onAddEntry={
        onAddDevice
          ? () => onAddDevice({ mode: 'flow', target: { domain: group.domain, title: group.name } })
          : undefined
      }
      onOptionsEntry={
        onAddDevice
          ? (entry) =>
              onAddDevice({
                mode: 'flow',
                target: {
                  domain: entry.domain,
                  entryId: entry.entryId,
                  kind: 'options',
                  title: entry.title || group.name,
                },
              })
          : undefined
      }
      onReconfigureEntry={
        onAddDevice
          ? (entry) =>
              onAddDevice({
                mode: 'flow',
                target: entry.attentionFlowId
                  ? {
                      flowId: entry.attentionFlowId,
                      domain: entry.domain,
                      title: entry.title || group.name,
                    }
                  : {
                      domain: entry.domain,
                      entryId: entry.entryId,
                      reconfigure: true,
                      title: entry.title || group.name,
                    },
              })
          : undefined
      }
      onReauthEntry={
        onAddDevice
          ? (entry) =>
              onAddDevice({
                mode: 'flow',
                target: entry.attentionFlowId
                  ? {
                      flowId: entry.attentionFlowId,
                      domain: entry.domain,
                      reauth: true,
                      title: entry.title || group.name,
                    }
                  : {
                      domain: entry.domain,
                      entryId: entry.entryId,
                      reauth: true,
                      title: entry.title || group.name,
                    },
              })
          : undefined
      }
      onReloadEntry={onReloadEntry}
      onToggleDisabled={onToggleDisabled}
      onDeleteEntry={onDeleteEntry}
      onFixRepair={onFixRepair}
      onToggleIgnoreRepair={onToggleIgnoreRepair}
      onConfigureDiscovered={
        onAddDevice
          ? (item) =>
              onAddDevice({
                mode: 'flow',
                target: {
                  flowId: item.flowId,
                  domain: item.handler,
                  title: item.integrationTitle,
                },
              })
          : undefined
      }
      onInstallUpdate={onInstallUpdate}
      onOpenHacs={meta?.runtimeType === 'custom_integration' && hasHacs ? onOpenHacs : undefined}
      onOpenExternal={onOpenExternal}
      onOpenDevice={(deviceId) => {
        const inv = home.inventory.find((item) => item.id === deviceId);
        onOpenEntity?.(inv?.accessory?.primaryEntityId ?? deviceId);
      }}
    />
  );
}
