/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ChevronRight } from 'lucide-react';
import { Box, HausScrollArea, Pressable, Text } from '@haus/ui';
import { diskDepth, diskDisplayName, orderDisks, partitionPurpose } from './presentation';
import { DiskIcon, storageMediaLabel } from './DiskIcon';
import type { ServerDisk } from './types';

export function diskTreeSubtitle(item: ServerDisk) {
  const subtitle =
    item.physical === true
      ? storageMediaLabel(item) || 'Physical disk'
      : item.type === 'partition'
        ? partitionPurpose(item) || 'Partition'
        : item.type === 'container'
          ? partitionPurpose(item) || 'Storage container'
          : item.type === 'disk' || item.kind === 'disk'
            ? 'Storage device'
            : item.filesystem || 'Volume';
  if (subtitle !== diskDisplayName(item)) return subtitle;
  return [item.partitionNumber ? `Partition ${item.partitionNumber}` : 'Partition', item.filesystem]
    .filter(Boolean)
    .join(' · ');
}

export function visibleDisks(disks: ServerDisk[], collapsed: ReadonlySet<string>) {
  const byId = new Map(disks.map((disk) => [disk.id, disk]));
  return orderDisks(disks).filter((disk) => {
    const seen = new Set([disk.id]);
    let parent = disk.parentId;
    while (parent && !seen.has(parent)) {
      if (collapsed.has(parent)) return false;
      seen.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    return true;
  });
}

export function DiskTree({
  disks,
  selected,
  collapsed,
  onSelect,
  onToggle,
}: {
  disks: ServerDisk[];
  selected: string;
  collapsed: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const ordered = orderDisks(disks),
    visible = visibleDisks(disks, collapsed);
  const selectAndFocus = (id: string, element: HTMLElement) => {
    onSelect(id);
    [...element.closest('[role="tree"]')!.querySelectorAll<HTMLElement>('[role="treeitem"]')]
      .find((row) => row.dataset.diskId === id)
      ?.focus();
  };
  // Keep groups mounted for entry/exit animation and stable telemetry refreshes.
  // A visited set also bounds malformed/cyclic parent relationships.
  const visited = new Set<string>();
  const branch = (item: ServerDisk): React.ReactNode => {
    if (visited.has(item.id)) return null;
    visited.add(item.id);
    const children = ordered.filter(
      (child) => child.parentId === item.id && !visited.has(child.id),
    );
    const expanded = children.length > 0 && !collapsed.has(item.id);
    const index = visible.findIndex((disk) => disk.id === item.id);
    return (
      <Box
        key={item.id}
        role="treeitem"
        tabIndex={item.id === selected ? 0 : -1}
        className="server-disk-tree-item"
        dataAttrs={{ 'data-disk-id': item.id }}
        ariaLabel={diskDisplayName(item)}
        ariaLevel={diskDepth(item, disks) + 1}
        ariaSelected={item.id === selected}
        ariaExpanded={children.length ? expanded : undefined}
        onKeyDown={(event) => {
          const targetEl = event.target instanceof HTMLElement ? event.target : null;
          const currentEl = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
          if (!targetEl || !currentEl || targetEl.closest('[role="treeitem"]') !== currentEl)
            return;
          let target: ServerDisk | undefined;
          if (event.key === 'ArrowDown') target = visible[index + 1];
          else if (event.key === 'ArrowUp') target = visible[index - 1];
          else if (event.key === 'Home') target = visible[0];
          else if (event.key === 'End') target = visible.at(-1);
          else if (event.key === 'ArrowRight') {
            if (children.length && !expanded) onToggle(item.id);
            else target = visible.find((child) => child.parentId === item.id);
          } else if (event.key === 'ArrowLeft') {
            if (expanded) onToggle(item.id);
            else target = visible.find((parent) => parent.id === item.parentId);
          } else if (event.key === 'Enter' || event.key === ' ') onSelect(item.id);
          else return;
          event.preventDefault();
          event.stopPropagation();
          if (target) selectAndFocus(target.id, currentEl);
        }}
      >
        <Box
          className={'server-disk-option ' + (item.id === selected ? 'is-selected' : '')}
          surfaceTokens={{ paddingInlineStart: 6 + diskDepth(item, disks) * 12 }}
          dataAttrs={{
            'data-physical': item.physical === true || undefined,
            'data-partition-role': item.partitionRole,
          }}
          onPress={() => onSelect(item.id)}
        >
          {children.length ? (
            <Pressable
              tabIndex={-1}
              className="server-disk-disclosure"
              ariaLabel={(expanded ? 'Collapse ' : 'Expand ') + diskDisplayName(item)}
              ariaExpanded={expanded}
              stopPropagation
              onPress={() => onToggle(item.id)}
            >
              <ChevronRight size={12} />
            </Pressable>
          ) : (
            <Text className="server-disk-disclosure-placeholder" />
          )}
          <DiskIcon disk={item} />
          <Text className="server-disk-option-label">
            <Text semantic="strong">{diskDisplayName(item)}</Text>
            <Text semantic="small">{diskTreeSubtitle(item)}</Text>
          </Text>
        </Box>
        {children.length > 0 && (
          <Box
            className={'server-disk-branch ' + (expanded ? 'is-expanded' : '')}
            ariaHidden={!expanded}
            inert={!expanded}
          >
            <Box className="server-disk-children" role="group">
              {children.map(branch)}
            </Box>
          </Box>
        )}
      </Box>
    );
  };
  const ids = new Set(disks.map((disk) => disk.id));
  const roots = ordered.filter((disk) => !disk.parentId || !ids.has(disk.parentId));
  return (
    <HausScrollArea
      className="server-disk-list"
      role="tree"
      aria-label="Disks and volumes"
      orientation="vertical"
      size={32}
    >
      {roots.map(branch)}
      {ordered.filter((disk) => !visited.has(disk.id)).map(branch)}
    </HausScrollArea>
  );
}
