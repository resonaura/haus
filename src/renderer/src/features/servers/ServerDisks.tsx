import { useState } from 'react';
import { bytes, diskDisplayName, orderDisks, partitionPurpose } from './presentation';
import { DiskSpaceBar } from './DiskSpaceBar';
import { DiskIcon, storageMediaLabel } from './DiskIcon';
import { DiskTree } from './DiskTree';
import type { ServerDisk } from './types';

export function ServerDisks({
  disks,
  lastKnown = false,
}: {
  disks: ServerDisk[];
  lastKnown?: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
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
  const select = (id: string) => {
    setSelected(id);
    // Bar/legend navigation may select a child of a folded ancestor.
    const ancestors = new Set<string>();
    let parent = disks.find((item) => item.id === id)?.parentId;
    while (parent && !ancestors.has(parent)) {
      ancestors.add(parent);
      parent = disks.find((item) => item.id === parent)?.parentId;
    }
    setCollapsed((current) => new Set([...current].filter((key) => !ancestors.has(key))));
  };
  const toggle = (id: string) => {
    const closing = !collapsed.has(id);
    if (closing) {
      const seen = new Set<string>();
      let parent = disk.parentId;
      while (parent && !seen.has(parent)) {
        if (parent === id) {
          setSelected(id);
          break;
        }
        seen.add(parent);
        parent = disks.find((item) => item.id === parent)?.parentId ?? null;
      }
    }
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <section className="server-panel server-disks" aria-label="Storage">
      <div className="server-disk-layout">
        <DiskTree
          disks={disks}
          selected={disk.id}
          collapsed={collapsed}
          onSelect={select}
          onToggle={toggle}
        />
        <div className="server-disk-detail" key={disk.id}>
          {lastKnown && <small className="server-last-known">Last known</small>}
          <div className="server-disk-heading">
            <span className="server-disk-icon">
              <DiskIcon disk={disk} size={34} />
            </span>
            <div>
              <h4>{diskDisplayName(disk)}</h4>
              <p>
                {[storageMediaLabel(disk), disk.filesystem, disk.mountpoint]
                  .filter(Boolean)
                  .join(' · ') || 'Storage device'}
              </p>
            </div>
            <strong>{bytes(disk.totalBytes)}</strong>
          </div>
          <DiskSpaceBar disk={disk} disks={disks} onSelect={select} />
          <dl className="server-disk-facts">
            {storageMediaLabel(disk) && (
              <div>
                <dt>Storage media</dt>
                <dd>{storageMediaLabel(disk)}</dd>
              </div>
            )}
            {disk.removable !== undefined && (
              <div>
                <dt>Removable media</dt>
                <dd>{disk.removable ? 'Yes' : 'No'}</dd>
              </div>
            )}
            {disk.hotplug !== undefined && (
              <div>
                <dt>Hot-plug connection</dt>
                <dd>{disk.hotplug ? 'Yes' : 'No'}</dd>
              </div>
            )}
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
                    (['efi', 'reserved', 'recovery'].includes(disk.partitionRole ?? '') &&
                    !disk.device?.startsWith('/dev/')
                      ? 'No drive letter'
                      : 'Not mounted')}
              </dd>
            </div>
            {disk.readOnly !== undefined && (
              <div>
                <dt>Device access</dt>
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
