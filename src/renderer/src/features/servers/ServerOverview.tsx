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
            <div>
              <dt>
                <Cpu size={14} />
                Processor
              </dt>
              <dd className="server-processor-value">
                <span>{host?.cpu.model?.replace(/\bGfx\b/g, 'GFX') || 'Not reported'}</span>
                <dl className="server-processor-facts">
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
              </dd>
            </div>
            <div>
              <dt>
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
                <MemoryStick size={14} />
                Memory
              </dt>
              <dd>{bytes(host?.memory.installedBytes)}</dd>
            </div>
            <div>
              <dt>
                <Layers size={14} />
                Reporting scope
              </dt>
              <dd>{hostMetricsScope(host ?? null)}</dd>
            </div>
            {host?.battery && (
              <div>
                <dt>
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
              Storage
            </h3>
            <button className="server-summary-link" onClick={() => onNavigate('storage')}>
              View Disks
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
            {serverHasNvr(server) && server.storage?.usage && (
              <div>
                <dt>Haus Files</dt>
                <dd>
                  <button className="server-summary-link" onClick={() => onNavigate('backups')}>
                    {!server.storage.usage.complete && '≥ '}
                    {bytes(server.storage.usage.logicalBytes)}
                  </button>
                </dd>
              </div>
            )}
          </dl>
          <p className="server-muted">
            {filesystem
              ? 'Usage shown for the largest reported mounted filesystem. Capacity excludes duplicate partitions and mounts.'
              : disks.separateVolumes
                ? 'Volumes may share the same backing storage. Open Disks to see each one separately.'
                : 'Partitions and mounted volumes are counted under their storage device. Usage appears when the whole device reports it.'}
          </p>
        </section>
        {services.length > 0 && (
          <section className="server-panel server-service-summary">
            <div className="server-section-heading">
              <h3>
                <Box size={18} />
                Service Activity
              </h3>
              <button className="server-summary-link" onClick={() => onNavigate('services')}>
                View services
              </button>
            </div>
            {!fresh && <p className="server-muted">Last known service status</p>}
            {services.map(
              ({ id, name, active, total, cpu, memory, cpuIncomplete, memoryIncomplete }) => (
                <div className="server-service-summary-row" key={name}>
                  <ServiceManagerIcon kind={id} host={host ?? null} size={22} />
                  <span>
                    <strong>{name}</strong>
                    <small>{`${active} running · ${total} total`}</small>
                  </span>
                  <ServiceUsage
                    cpu={cpu}
                    memory={memory}
                    cpuIncomplete={cpuIncomplete}
                    memoryIncomplete={memoryIncomplete}
                    totalMemory={host?.memory.totalBytes ?? null}
                  />
                </div>
              ),
            )}
          </section>
        )}
      </div>
    </>
  );
}
