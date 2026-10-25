import { ProgressBar } from '@heroui/react';
import {
  Archive,
  Database,
  FileVideo,
  Files,
  HardDrive,
  Image,
  Layers,
  Radio,
  Settings,
  Timer,
  Video,
} from 'lucide-react';
import { bytes } from './presentation';
import type { HausStorageUsage as Usage } from './types';

const categories = {
  originals: ['Original Recordings', Video],
  prepared: ['Prepared Playback', FileVideo],
  prebuffer: ['Pre-event Buffer', Timer],
  snapshots: ['Snapshots & Thumbnails', Image],
  'ha-backups': ['Home Assistant Backups', Archive],
  'config-backups': ['Configuration Backups', Archive],
  databases: ['Databases', Database],
  logs: ['Logs', Files],
  configuration: ['Configuration', Settings],
  capture: ['Capture in Progress', Video],
  preparation: ['Playback Preparation', FileVideo],
  'stream-cache': ['Stream Cache', Radio],
  temporary: ['Temporary Files', Timer],
  'other-media': ['Unclassified Media', FileVideo],
  shared: ['Shared Files', Layers],
  other: ['Other Haus Files', Files],
} as const;

export function HausStorageUsage({
  usage,
  online,
}: {
  usage: Usage | null | undefined;
  online: boolean;
}) {
  const rows =
    usage?.categories
      .filter((row) => Number.isSafeInteger(row.logicalBytes) && row.logicalBytes >= 0)
      .sort((a, b) => b.logicalBytes - a.logicalBytes) ?? [];
  const stale = Boolean(usage) && (!online || Date.now() - usage!.sampledAt > 90000);
  const measuring = online && usage === null;
  return (
    <section className="server-panel server-haus-storage" aria-label="Haus Storage">
      <div className="server-section-heading">
        <h3>
          <HardDrive size={18} />
          Haus Storage
        </h3>
        {usage && (
          <span>
            {!usage.complete && '≥ '}
            {bytes(usage.logicalBytes)}
          </span>
        )}
      </div>
      {!usage ? (
        <>
          <p className="server-muted">
            {measuring
              ? 'Measuring files managed by Haus…'
              : 'This server has not reported storage measurements yet.'}
          </p>
          {measuring && (
            <ProgressBar aria-label="Measuring Haus storage" isIndeterminate>
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
          )}
        </>
      ) : (
        <>
          {Boolean(usage.logicalBytes) && (
            <div
              className="server-haus-storage-bar"
              role="group"
              aria-label="Haus file size by component"
            >
              {rows.map((row, index) => (
                <span
                  key={row.id}
                  style={{ flexGrow: row.logicalBytes, opacity: 0.3 + (index % 5) * 0.14 }}
                  title={`${(categories[row.id as keyof typeof categories] ?? categories.other)[0]}: ${bytes(row.logicalBytes)}`}
                />
              ))}
            </div>
          )}
          <div className="server-haus-storage-head" aria-hidden="true">
            <span>Component</span>
            <span>File Size</span>
            <span>Allocated</span>
          </div>
          <dl className="server-haus-storage-list">
            {rows.map((row) => {
              const [label, Icon] =
                categories[row.id as keyof typeof categories] ?? categories.other;
              return (
                <div key={row.id}>
                  <dt>
                    <Icon size={16} />
                    <span>{label}</span>
                  </dt>
                  <dd>{bytes(row.logicalBytes)}</dd>
                  <dd>{bytes(row.allocatedBytes)}</dd>
                </div>
              );
            })}
            <div className="server-haus-storage-total">
              <dt>Total{stale ? ' · Last Known' : !usage.complete ? ' · Partial' : ''}</dt>
              <dd>
                {!usage.complete && '≥ '}
                {bytes(usage.logicalBytes)}
              </dd>
              <dd>
                {!usage.complete && usage.allocatedBytes !== null && '≥ '}
                {bytes(usage.allocatedBytes)}
              </dd>
            </div>
          </dl>
          {!usage.complete && (
            <p className="server-muted" role="status">
              Some files could not be measured. These totals show at least the reported amount.
            </p>
          )}
          {rows.some((row) => row.id === 'other-media') && (
            <p className="server-muted">
              Unclassified media has no confirmed recording variant yet. Classification is updated
              from the recording catalog.
            </p>
          )}
          <small className="server-muted">
            {stale ? 'Last measured' : 'Measured'} {new Date(usage.sampledAt).toLocaleTimeString()}{' '}
            · Updates in the background
          </small>
          <details className="server-haus-storage-about">
            <summary>About these measurements</summary>
            <p className="server-muted">
              Across this server’s Haus storage locations, separate from total disk usage.
              Hard-linked files count once; files used by multiple components appear as Shared
              Files. Allocated blocks can share physical storage through compression or snapshots.
              Container images and external service logs are outside these totals.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
