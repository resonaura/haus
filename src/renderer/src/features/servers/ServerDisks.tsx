import { useState } from 'react';
import { HardDrive } from 'lucide-react';
import { bytes, orderDisks, percent, ratio } from './presentation';
import type { ServerDisk } from './types';

export function ServerDisks({ disks }: { disks: ServerDisk[] }) {
  const [selected, setSelected] = useState<string>();
  const ordered = orderDisks(disks);
  const disk =
    ordered.find((item) => item.id === selected) ??
    ordered.find((item) => item.usedBytes !== null) ??
    ordered[0];
  if (!disk)
    return (
      <section className="server-panel">
        <h3>Storage</h3>
        <p className="server-muted">Disk information is not available on this server yet.</p>
      </section>
    );
  const used = ratio(disk.usedBytes, disk.totalBytes);
  const deviceCount = disks.filter((item) => item.kind === 'disk').length;
  const available = ratio(disk.availableBytes, disk.totalBytes);
  const other = used !== null && available !== null ? Math.max(0, 1 - used - available) : 0;
  return (
    <section className="server-panel server-disks">
      <div className="server-section-heading">
        <h3>Storage</h3>
        <span>
          {deviceCount || disks.length}{' '}
          {deviceCount
            ? deviceCount === 1
              ? 'device'
              : 'devices'
            : disks.length === 1
              ? 'volume'
              : 'volumes'}
        </span>
      </div>
      <div className="server-disk-layout">
        <div className="server-disk-list" aria-label="Disks and volumes">
          {ordered.map((item) => (
            <button
              key={item.id}
              className={`server-disk-option ${item.id === disk.id ? 'is-selected' : ''} ${item.parentId ? 'is-volume' : ''}`}
              onClick={() => setSelected(item.id)}
              aria-pressed={item.id === disk.id}
            >
              <HardDrive size={20} />
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.kind === 'disk' ? 'Physical disk' : item.filesystem || 'Volume'}
                </small>
              </span>
            </button>
          ))}
        </div>
        <div className="server-disk-detail" key={disk.id}>
          <div className="server-disk-heading">
            <span className="server-disk-icon">
              <HardDrive size={34} />
            </span>
            <div>
              <h4>{disk.name}</h4>
              <p>
                {[disk.filesystem, disk.mountpoint].filter(Boolean).join(' · ') || 'Storage device'}
              </p>
            </div>
            <strong>{bytes(disk.totalBytes)}</strong>
          </div>
          <div
            className="server-disk-bar"
            role="img"
            aria-label={`${disk.name}: ${bytes(disk.usedBytes)} used, ${bytes(disk.availableBytes)} available`}
          >
            {used !== null && (
              <span className="server-disk-used" style={{ width: percent(used) }} />
            )}
            {other > 0.005 && (
              <span className="server-disk-reserved" style={{ width: percent(other) }} />
            )}
          </div>
          <div className="server-disk-legend">
            <span>
              <i className="is-used" />
              Used <strong>{bytes(disk.usedBytes)}</strong>
            </span>
            {other > 0.005 && (
              <span>
                <i className="is-reserved" />
                Reserved <strong>{bytes(other * disk.totalBytes)}</strong>
              </span>
            )}
            <span>
              <i />
              Available <strong>{bytes(disk.availableBytes)}</strong>
            </span>
          </div>
          <dl className="server-disk-facts">
            <div>
              <dt>Mount point</dt>
              <dd>{disk.mountpoint || 'Not mounted'}</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>{disk.filesystem || 'Not reported'}</dd>
            </div>
            <div>
              <dt>Capacity</dt>
              <dd>{bytes(disk.totalBytes)}</dd>
            </div>
            <div>
              <dt>Reporting scope</dt>
              <dd>{disk.scope === 'container' ? 'Container volume' : 'Server'}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
