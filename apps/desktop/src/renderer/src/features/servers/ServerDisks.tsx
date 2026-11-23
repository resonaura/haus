/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, Heading, Text } from '@haus/ui';
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
      <Box semantic="section" className="server-panel">
        <Heading level={3}>Disks</Heading>
        <Text semantic="p" className="server-muted">
          Disk information is not available on this server yet.
        </Text>
      </Box>
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
    <Box semantic="section" className="server-panel server-disks" ariaLabel="Storage">
      <Box className="server-disk-layout">
        <DiskTree
          disks={disks}
          selected={disk.id}
          collapsed={collapsed}
          onSelect={select}
          onToggle={toggle}
        />
        <Box className="server-disk-detail" key={disk.id}>
          {lastKnown && (
            <Text semantic="small" className="server-last-known">
              Last known
            </Text>
          )}
          <Box className="server-disk-heading">
            <Text className="server-disk-icon">
              <DiskIcon disk={disk} size={34} />
            </Text>
            <Box>
              <Heading level={4}>{diskDisplayName(disk)}</Heading>
              <Text semantic="p">
                {[storageMediaLabel(disk), disk.filesystem, disk.mountpoint]
                  .filter(Boolean)
                  .join(' · ') || 'Storage device'}
              </Text>
            </Box>
            <Text semantic="strong">{bytes(disk.totalBytes)}</Text>
          </Box>
          <DiskSpaceBar disk={disk} disks={disks} onSelect={select} />
          <Box semantic="dl" className="server-disk-facts">
            {storageMediaLabel(disk) && (
              <Box>
                <Box semantic="dt">Storage media</Box>
                <Box semantic="dd">{storageMediaLabel(disk)}</Box>
              </Box>
            )}
            {disk.removable !== undefined && (
              <Box>
                <Box semantic="dt">Removable media</Box>
                <Box semantic="dd">{disk.removable ? 'Yes' : 'No'}</Box>
              </Box>
            )}
            {disk.hotplug !== undefined && (
              <Box>
                <Box semantic="dt">Hot-plug connection</Box>
                <Box semantic="dd">{disk.hotplug ? 'Yes' : 'No'}</Box>
              </Box>
            )}
            {partitionPurpose(disk) && (
              <Box>
                <Box semantic="dt">Purpose</Box>
                <Box semantic="dd">{partitionPurpose(disk)}</Box>
              </Box>
            )}
            {disk.partitionNumber !== undefined && (
              <Box>
                <Box semantic="dt">Partition</Box>
                <Box semantic="dd">{disk.partitionNumber}</Box>
              </Box>
            )}
            {disk.device && (
              <Box>
                <Box semantic="dt">Device</Box>
                <Box semantic="dd">{disk.device}</Box>
              </Box>
            )}
            <Box>
              <Box semantic="dt">
                {(disk.mountpoints?.length ?? 0) > 1 ? 'Mount points' : 'Mount point'}
              </Box>
              <Box semantic="dd">
                {disk.mountpoints?.length
                  ? disk.mountpoints.join(' · ')
                  : disk.mountpoint ||
                    (['efi', 'reserved', 'recovery'].includes(disk.partitionRole ?? '') &&
                    !disk.device?.startsWith('/dev/')
                      ? 'No drive letter'
                      : 'Not mounted')}
              </Box>
            </Box>
            {disk.readOnly !== undefined && (
              <Box>
                <Box semantic="dt">Device access</Box>
                <Box semantic="dd">{disk.readOnly ? 'Read only' : 'Read and write'}</Box>
              </Box>
            )}
            <Box>
              <Box semantic="dt">Format</Box>
              <Box semantic="dd">{disk.filesystem || 'Not reported'}</Box>
            </Box>
            <Box>
              <Box semantic="dt">Capacity</Box>
              <Box semantic="dd">{bytes(disk.totalBytes)}</Box>
            </Box>
            <Box>
              <Box semantic="dt">Reporting scope</Box>
              <Box semantic="dd">{disk.scope === 'container' ? 'Container volume' : 'Server'}</Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
