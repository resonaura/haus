import { useState } from 'react';
import { HardDrive } from 'lucide-react';
import {
  bytes,
  diskDepth,
  diskOtherAllocated,
  orderDisks,
  partitionPurpose,
  percent,
  ratio,
} from './presentation';
import type { ServerDisk } from './types';

export function ServerDisks({
  disks,
  lastKnown = false,
}: {
  disks: ServerDisk[];
  lastKnown?: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const ordered = orderDisks(disks);
  const disk =
    ordered.find((item) => item.id === selected) ??
    ordered.find((item) => item.type === 'volume' && item.mountpoint && item.usedBytes !== null) ??
    ordered.find((item) => item.usedBytes !== null) ??
    ordered[0];
  if (!disk)
    return (
      <section className="server-panel">
        <h3>Disks</h3>
        <p className="server-muted">Disk information is not available on this server yet.</p>
      </section>
    );
  const used = ratio(disk.usedBytes, disk.totalBytes);
  const deviceCount = disks.filter(
    (item) =>
      item.physical === true ||
      (item.physical === undefined && item.kind === 'disk' && !item.parentId),
  ).length;
  const otherBytes = diskOtherAllocated(disk);
  const other = ratio(otherBytes, disk.totalBytes) ?? 0;
  return (
    <section className="server-panel server-disks">
      <div className="server-section-heading">
        <h3>Disks{lastKnown && <small className="server-last-known">Last known</small>}</h3>
        <span>
          {deviceCount || disks.length}{' '}
          {deviceCount
            ? deviceCount === 1
              ? 'device'
              : 'devices'
            : disks.some((item) => item.physical === null || (item.type && item.type !== 'volume'))
              ? disks.length === 1
                ? 'storage item'
                : 'storage items'
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
              className={`server-disk-option ${item.id === disk.id ? 'is-selected' : ''}`}
              style={{ paddingInlineStart: 10 + diskDepth(item, disks) * 12 }}
              onClick={() => setSelected(item.id)}
              aria-pressed={item.id === disk.id}
            >
              <HardDrive size={20} />
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.physical === true
                    ? 'Physical disk'
                    : item.type === 'partition'
                      ? partitionPurpose(item) || 'Partition'
                      : item.type === 'container'
                        ? partitionPurpose(item) || 'Storage container'
                        : item.type === 'disk' || item.kind === 'disk'
                          ? 'Storage device'
                          : item.filesystem || 'Volume'}
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
                Other allocated <strong>{bytes(otherBytes)}</strong>
              </span>
            )}
            <span>
              <i />
              Available <strong>{bytes(disk.availableBytes)}</strong>
            </span>
          </div>
          <dl className="server-disk-facts">
            {partitionPurpose(disk) && (
              <div>
                <dt>Purpose</dt>
                <dd>{partitionPurpose(disk)}</dd>
              </div>
            )}
            {disk.partitionNumber !== undefined && (
              <div>
                <dt>Partition</dt>
                <dd>{disk.partitionNumber}</dd>
              </div>
            )}
            {disk.device && (
              <div>
                <dt>Device</dt>
                <dd>{disk.device}</dd>
              </div>
            )}
            <div>
              <dt>{(disk.mountpoints?.length ?? 0) > 1 ? 'Mount points' : 'Mount point'}</dt>
              <dd>
                {disk.mountpoints?.length
                  ? disk.mountpoints.join(' · ')
                  : disk.mountpoint ||
                    (['efi', 'reserved', 'recovery'].includes(disk.partitionRole ?? '')
                      ? 'No drive letter'
                      : 'Not mounted')}
              </dd>
            </div>
            {disk.readOnly !== undefined && (
              <div>
                <dt>Access</dt>
                <dd>{disk.readOnly ? 'Read only' : 'Read and write'}</dd>
              </div>
            )}
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
