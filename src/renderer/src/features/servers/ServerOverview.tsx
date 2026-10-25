import {
  Box,
  Battery,
  ChevronRight,
  Cpu,
  HardDrive,
  Layers,
  MemoryStick,
  Monitor,
  Workflow,
} from 'lucide-react';
import { useState } from 'react';
import { ServerIcon } from '../../components/icons/ServerIcon';
import { resolveServerIcon } from '../../model/server-icon';
import { BatteryLevelIcon } from '../../components/icons/Icon';
import { ResourceCards } from './ResourceCards';
import { bytes, percent, ratio } from './presentation';
import { diskSummary, serviceSummary } from './server-dashboard';
import type { HomeServer, ResourceSample } from './types';
import { hostBatteryStatus, hostMetricsScope, hostOperatingSystem } from './host-system';
import { ServerGraphics } from './ServerGraphics';

export function ServerOverview({
  server,
  history,
  fresh,
  onNavigate,
}: {
  server: HomeServer;
  history: ResourceSample[];
  fresh: boolean;
  onNavigate: (tab: string) => void;
}) {
  const [processorExpanded, setProcessorExpanded] = useState(true);
  const host = server.host;
  const osIcon = resolveServerIcon({ host });
  const disks = diskSummary(host?.disks ?? []);
  const services = serviceSummary(host);
  const load =
    host?.cpu.loadAverage.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    ) ?? [];
  const filesystem = disks.usedBytes === null ? disks.largestMounted : undefined;
  const usedBytes = filesystem?.usedBytes ?? disks.usedBytes;
  const availableBytes = filesystem?.availableBytes ?? disks.availableBytes;
  const usage = fresh ? ratio(usedBytes, filesystem?.totalBytes ?? disks.capacityBytes) : null;
  return (
    <>
      <ResourceCards server={server} history={history} fresh={fresh} />
      <div className="server-dashboard-grid">
        <section className="server-panel server-system-summary">
          <h3>
            <Monitor size={18} />
            System
          </h3>
          <dl className="server-system-facts">
            <div
              className={
                'server-system-processor-group' + (processorExpanded ? ' is-expanded' : '')
              }
            >
              <dt>
                <button
                  type="button"
                  className="server-system-disclosure"
                  aria-expanded={processorExpanded}
                  aria-controls="server-processor-details"
                  aria-label={
                    processorExpanded ? 'Collapse processor details' : 'Expand processor details'
                  }
                  onClick={() => setProcessorExpanded((expanded) => !expanded)}
                >
                  <span className="server-system-disclosure-chevron">
                    <ChevronRight size={12} />
                  </span>
                  <Cpu size={14} />
                  Processor
                </button>
              </dt>
              <dd>{host?.cpu.model || 'Not reported'}</dd>
              <dd
                id="server-processor-details"
                className="server-system-processor-branch"
                aria-hidden={!processorExpanded}
                inert={!processorExpanded}
              >
                <div className="server-system-processor-inner">
                  <dl className="server-system-processor-facts">
                    <div>
                      <dt>Logical cores</dt>
                      <dd>{host?.cpu.logicalCores ?? 'Not reported'}</dd>
                    </div>
                    <div>
                      <dt>Load average</dt>
                      <dd
                        aria-label={
                          fresh && load.length
                            ? `Load average ${load.map((value) => value.toFixed(2)).join(' · ')}`
                            : undefined
                        }
                      >
                        {fresh && load.length
                          ? load.map((value) => value.toFixed(2)).join(' · ')
                          : 'Not available'}
                      </dd>
                    </div>
                  </dl>
                </div>
              </dd>
            </div>
            <div>
              <dt>
                <span className="server-system-disclosure-placeholder" aria-hidden="true" />
                <Monitor size={14} />
                Operating system
              </dt>
              <dd className="server-os-value">
                {osIcon !== 'server' && (
                  <ServerIcon server={{ host }} size={16} className="server-os-brand-icon" />
                )}
                <span>{hostOperatingSystem(host ?? null)}</span>
              </dd>
            </div>
            <ServerGraphics host={host ?? null} fresh={fresh} />
            <div>
              <dt>
                <span className="server-system-disclosure-placeholder" aria-hidden="true" />
                <MemoryStick size={14} />
                Memory
              </dt>
              <dd>{bytes(host?.memory.installedBytes ?? host?.memory.totalBytes)}</dd>
            </div>
            <div>
              <dt>
                <span className="server-system-disclosure-placeholder" aria-hidden="true" />
                <Layers size={14} />
                Reporting scope
              </dt>
              <dd>{hostMetricsScope(host ?? null)}</dd>
            </div>
            {host?.battery && (
              <div>
                <dt>
                  <span className="server-system-disclosure-placeholder" aria-hidden="true" />
                  <Battery size={14} />
                  Battery
                </dt>
                <dd className="server-battery-reading">
                  <BatteryLevelIcon
                    level={host.battery.level ?? undefined}
                    charging={host.battery.charging ?? undefined}
                    powerConnected={host.battery.powerConnected ?? undefined}
                    size={15}
                  />
                  <span>
                    {host.battery.level === null
                      ? 'Level unavailable'
                      : `${Math.round(host.battery.level)}%`}
                    {hostBatteryStatus(host.battery) ? ` · ${hostBatteryStatus(host.battery)}` : ''}
                  </span>
                </dd>
              </div>
            )}
          </dl>
          {host?.scope === 'container' && (
            <p className="server-muted">
              This service reports container resources. Host information appears when the server
              shares it.
            </p>
          )}
        </section>
        <section className="server-panel server-storage-summary">
          <div className="server-section-heading">
            <h3>
              <HardDrive size={18} />
              Disk capacity
            </h3>
            <button className="server-summary-link" onClick={() => onNavigate('storage')}>
              View disks
            </button>
          </div>
          <strong className="server-summary-value">
            {disks.separateVolumes ? 'Not combined' : bytes(disks.capacityBytes)}
          </strong>
          <p className="server-muted">
            {disks.deviceCount
              ? `${disks.deviceCount} ${disks.deviceCount === 1 ? 'storage device' : 'storage devices'}`
              : disks.reportedItems
                ? `${disks.reportedItems} reported storage ${disks.reportedItems === 1 ? 'item' : 'items'}`
                : 'Disk information is not available yet'}
          </p>
          {usage !== null && (
            <div className="server-summary-meter" aria-label={`${percent(usage)} used`}>
              <span style={{ width: percent(usage) }} />
            </div>
          )}
          <dl className="server-system-facts">
            <div>
              <dt>{filesystem ? `Used on ${filesystem.mountpoint}` : 'Used'}</dt>
              <dd>{fresh ? bytes(usedBytes) : 'Last known'}</dd>
            </div>
            <div>
              <dt>{filesystem ? `Available on ${filesystem.mountpoint}` : 'Available'}</dt>
              <dd>{fresh ? bytes(availableBytes) : 'Last known'}</dd>
            </div>
          </dl>
          <p className="server-muted">
            {filesystem
              ? 'Usage shown for the largest reported mounted filesystem. Capacity excludes duplicate partitions and mounts.'
              : disks.separateVolumes
                ? 'Volumes may share the same backing storage. Open Disks to see each one separately.'
                : 'Partitions and mounted volumes are counted under their storage device. Usage appears when the whole device reports it.'}
          </p>
        </section>
        <section className="server-panel server-service-summary">
          <div className="server-section-heading">
            <h3>
              <Box size={18} />
              Service activity
            </h3>
            <button className="server-summary-link" onClick={() => onNavigate('services')}>
              View services
            </button>
          </div>
          {!fresh && <p className="server-muted">Last known service status</p>}
          {[
            { name: 'Docker', Icon: Box, status: services.docker },
            { name: 'PM2', Icon: Workflow, status: services.pm2 },
          ].map(({ name, Icon, status }) => (
            <div className="server-service-summary-row" key={name}>
              <Icon size={22} />
              <span>
                <strong>{name}</strong>
                <small>
                  {status ? `${status.active} running · ${status.total} total` : 'Not reporting'}
                </small>
              </span>
              {status && status.attention > 0 && (
                <span className="server-service-attention">{status.attention} need attention</span>
              )}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
