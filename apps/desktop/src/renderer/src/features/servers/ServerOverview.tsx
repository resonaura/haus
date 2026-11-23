/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box as UiBox, Heading, Pressable, Text } from '@haus/ui';
import { Box, Battery, Cpu, HardDrive, Layers, MemoryStick, Monitor } from 'lucide-react';
import { ServerIcon } from '../../components/icons/ServerIcon';
import { resolveServerIcon } from '../../model/server-icon';
import { BatteryLevelIcon } from '../../components/icons/Icon';
import { ResourceCards } from './ResourceCards';
import { bytes, percent, ratio } from './presentation';
import { diskSummary } from './server-dashboard';
import { serviceActivity } from './service-activity';
import { ServiceUsage } from './ServiceUsage';
import { ServiceManagerIcon } from './ServiceManagerIcon';
import type { HomeServer, ResourceSample } from './types';
import { hostBatteryStatus, hostMetricsScope, hostOperatingSystem } from './host-system';
import { ServerGraphics } from './ServerGraphics';
import { serverHasNvr } from './server-connections';

export function ServerOverview({
  server,
  history,
  fresh,
  now,
  onNavigate,
}: {
  server: HomeServer;
  history: ResourceSample[];
  fresh: boolean;
  now: number;
  onNavigate: (tab: string) => void;
}) {
  const host = server.host;
  const osIcon = resolveServerIcon({ host });
  const disks = diskSummary(host?.disks ?? []);
  const services = serviceActivity(host, fresh, now);
  const load =
    host?.cpu?.loadAverage?.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    ) ?? [];
  const filesystem = disks.usedBytes === null ? disks.largestMounted : undefined;
  const usedBytes = filesystem?.usedBytes ?? disks.usedBytes;
  const availableBytes = filesystem?.availableBytes ?? disks.availableBytes;
  const usage = fresh ? ratio(usedBytes, filesystem?.totalBytes ?? disks.capacityBytes) : null;
  return (
    <>
      <ResourceCards server={server} history={history} fresh={fresh} />
      <UiBox className="server-dashboard-grid">
        <UiBox semantic="section" className="server-panel server-system-summary">
          <Heading level={3}>
            <Monitor size={18} />
            System
          </Heading>
          <UiBox semantic="dl" className="server-system-facts">
            <UiBox>
              <UiBox semantic="dt">
                <Cpu size={14} />
                Processor
              </UiBox>
              <UiBox semantic="dd" className="server-processor-value">
                <Text>{host?.cpu?.model?.replace(/\bGfx\b/g, 'GFX') || 'Not reported'}</Text>
                <UiBox semantic="dl" className="server-processor-facts">
                  <UiBox>
                    <UiBox semantic="dt">Logical cores</UiBox>
                    <UiBox semantic="dd">{host?.cpu?.logicalCores ?? 'Not reported'}</UiBox>
                  </UiBox>
                  <UiBox>
                    <UiBox semantic="dt">Load average</UiBox>
                    <UiBox
                      semantic="dd"
                      ariaLabel={
                        fresh && load.length
                          ? `Load average ${load.map((value) => value.toFixed(2)).join(' · ')}`
                          : undefined
                      }
                    >
                      {fresh && load.length
                        ? load.map((value) => value.toFixed(2)).join(' · ')
                        : 'Not available'}
                    </UiBox>
                  </UiBox>
                </UiBox>
              </UiBox>
            </UiBox>
            <UiBox>
              <UiBox semantic="dt">
                <Monitor size={14} />
                Operating system
              </UiBox>
              <UiBox semantic="dd" className="server-os-value">
                {osIcon !== 'server' && (
                  <ServerIcon server={{ host }} size={16} className="server-os-brand-icon" />
                )}
                <Text>{hostOperatingSystem(host ?? null)}</Text>
              </UiBox>
            </UiBox>
            <ServerGraphics host={host ?? null} fresh={fresh} />
            <UiBox>
              <UiBox semantic="dt">
                <MemoryStick size={14} />
                Memory
              </UiBox>
              <UiBox semantic="dd">{bytes(host?.memory?.installedBytes)}</UiBox>
            </UiBox>
            <UiBox>
              <UiBox semantic="dt">
                <Layers size={14} />
                Reporting scope
              </UiBox>
              <UiBox semantic="dd">{hostMetricsScope(host ?? null)}</UiBox>
            </UiBox>
            {host?.battery && (
              <UiBox>
                <UiBox semantic="dt">
                  <Battery size={14} />
                  Battery
                </UiBox>
                <UiBox semantic="dd" className="server-battery-reading">
                  <BatteryLevelIcon
                    level={host.battery.level ?? undefined}
                    charging={host.battery.charging ?? undefined}
                    powerConnected={host.battery.powerConnected ?? undefined}
                    size={15}
                  />
                  <Text>
                    {host.battery.level === null
                      ? 'Level unavailable'
                      : `${Math.round(host.battery.level)}%`}
                    {hostBatteryStatus(host.battery) ? ` · ${hostBatteryStatus(host.battery)}` : ''}
                  </Text>
                </UiBox>
              </UiBox>
            )}
          </UiBox>
          {host?.scope === 'container' && (
            <Text semantic="p" className="server-muted">
              This service reports container resources. Host information appears when the server
              shares it.
            </Text>
          )}
        </UiBox>
        <UiBox semantic="section" className="server-panel server-storage-summary">
          <UiBox className="server-section-heading">
            <Heading level={3}>
              <HardDrive size={18} />
              Storage
            </Heading>
            <Pressable className="server-summary-link" onPress={() => onNavigate('storage')}>
              View Disks
            </Pressable>
          </UiBox>
          <Text semantic="strong" className="server-summary-value">
            {disks.separateVolumes ? 'Not combined' : bytes(disks.capacityBytes)}
          </Text>
          <Text semantic="p" className="server-muted">
            {disks.deviceCount
              ? `${disks.deviceCount} ${disks.deviceCount === 1 ? 'storage device' : 'storage devices'}`
              : disks.reportedItems
                ? `${disks.reportedItems} reported storage ${disks.reportedItems === 1 ? 'item' : 'items'}`
                : 'Disk information is not available yet'}
          </Text>
          {usage !== null && (
            <UiBox className="server-summary-meter" ariaLabel={`${percent(usage)} used`}>
              <Text surfaceTokens={{ width: percent(usage) }} />
            </UiBox>
          )}
          <UiBox semantic="dl" className="server-system-facts">
            <UiBox>
              <UiBox semantic="dt">
                {filesystem ? `Used on ${filesystem.mountpoint}` : 'Used'}
              </UiBox>
              <UiBox semantic="dd">{fresh ? bytes(usedBytes) : 'Last known'}</UiBox>
            </UiBox>
            <UiBox>
              <UiBox semantic="dt">
                {filesystem ? `Available on ${filesystem.mountpoint}` : 'Available'}
              </UiBox>
              <UiBox semantic="dd">{fresh ? bytes(availableBytes) : 'Last known'}</UiBox>
            </UiBox>
            {serverHasNvr(server) && server.storage?.usage && (
              <UiBox>
                <UiBox semantic="dt">Haus Files</UiBox>
                <UiBox semantic="dd">
                  <Pressable className="server-summary-link" onPress={() => onNavigate('backups')}>
                    {!server.storage.usage.complete && '≥ '}
                    {bytes(server.storage.usage.logicalBytes)}
                  </Pressable>
                </UiBox>
              </UiBox>
            )}
          </UiBox>
          <Text semantic="p" className="server-muted">
            {filesystem
              ? 'Usage shown for the largest reported mounted filesystem. Capacity excludes duplicate partitions and mounts.'
              : disks.separateVolumes
                ? 'Volumes may share the same backing storage. Open Disks to see each one separately.'
                : 'Partitions and mounted volumes are counted under their storage device. Usage appears when the whole device reports it.'}
          </Text>
        </UiBox>
        {services.length > 0 && (
          <UiBox semantic="section" className="server-panel server-service-summary">
            <UiBox className="server-section-heading">
              <Heading level={3}>
                <Box size={18} />
                Service Activity
              </Heading>
              <Pressable className="server-summary-link" onPress={() => onNavigate('services')}>
                View services
              </Pressable>
            </UiBox>
            {!fresh && (
              <Text semantic="p" className="server-muted">
                Last known service status
              </Text>
            )}
            {services.map(
              ({ id, name, active, total, cpu, memory, cpuIncomplete, memoryIncomplete }) => (
                <UiBox className="server-service-summary-row" key={name}>
                  <ServiceManagerIcon kind={id} host={host ?? null} size={22} />
                  <Text>
                    <Text semantic="strong">{name}</Text>
                    <Text semantic="small">{`${active} running · ${total} total`}</Text>
                  </Text>
                  <ServiceUsage
                    cpu={cpu}
                    memory={memory}
                    cpuIncomplete={cpuIncomplete}
                    memoryIncomplete={memoryIncomplete}
                    totalMemory={host?.memory?.totalBytes ?? null}
                  />
                </UiBox>
              ),
            )}
          </UiBox>
        )}
      </UiBox>
    </>
  );
}
