/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import {
  formatBytes,
  orderServerDisks,
  serverDiskDepth,
  serverDiskDisplayName,
  serverDiskTreeSubtitle,
  serverPartitionPurpose,
  serverStorageMediaLabel,
  visibleServerDisks,
  type ServerDiskRecord,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, Heading, Pressable, Row, ScrollView, Stack, Text } from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { UiIcon } from '../icon.js';
import { ServerDiskGlyph } from './server-icons.js';
import { ServerFactRow, ServerGlassPanel } from './server-surfaces.js';
import { ServerDiskSpaceBar } from './server-visuals.js';

/**
 * 100% Electron-matched master-detail Disks workspace inside a Liquid Glass surface:
 * - Left sidebar: hierarchical physical disk -> partition / container / volume tree with disclosure chevrons.
 * - Right pane: Liquid Glass icon badge, multi-segment partition/pool/space bar, and full hardware/mount facts.
 */
export function ServerDisksTab({
  disks,
  reportingScope,
  lastKnown = false,
}: {
  readonly disks: readonly ServerDiskRecord[];
  readonly reportingScope?: 'host' | 'container';
  readonly lastKnown?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const ordered = orderServerDisks(disks);
  const activeDisk =
    ordered.find((item) => item.id === selectedId) ??
    ordered.find((item) => item.type === 'volume' && item.mountpoint && item.usedBytes !== null) ??
    ordered.find((item) => item.usedBytes !== null) ??
    ordered[0];

  if (!activeDisk) {
    return (
      <ServerGlassPanel padding={insets(24)} radius={24}>
        <Stack gapPx={6}>
          <Heading level={3} size={15} weight={600}>
            Disks
          </Heading>
          <Text size={12.5} tone="muted">
            Disk information is not available on this server yet.
          </Text>
        </Stack>
      </ServerGlassPanel>
    );
  }

  const selectDisk = (id: string) => {
    setSelectedId(id);
    const ancestors = new Set<string>();
    let parent = disks.find((item) => item.id === id)?.parentId ?? null;
    while (parent && !ancestors.has(parent)) {
      ancestors.add(parent);
      parent = disks.find((item) => item.id === parent)?.parentId ?? null;
    }
    if (ancestors.size > 0) {
      setCollapsed((current) => new Set([...current].filter((key) => !ancestors.has(key))));
    }
  };

  const toggleCollapse = (id: string) => {
    const closing = !collapsed.has(id);
    if (closing) {
      const seen = new Set<string>();
      let parent = activeDisk.parentId ?? null;
      while (parent && !seen.has(parent)) {
        if (parent === id) {
          setSelectedId(id);
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

  const visible = visibleServerDisks(disks, collapsed);
  const childCountById = new Map<string, number>();
  for (const item of ordered) {
    if (item.parentId) {
      childCountById.set(item.parentId, (childCountById.get(item.parentId) ?? 0) + 1);
    }
  }

  const mediaLabel = serverStorageMediaLabel(activeDisk);
  const purposeLabel = serverPartitionPurpose(activeDisk);
  const effectiveScope = activeDisk.scope ?? reportingScope;
  const mountDisplay = activeDisk.mountpoints?.length
    ? activeDisk.mountpoints.join(' · ')
    : activeDisk.mountpoint ||
      (['efi', 'reserved', 'recovery'].includes(activeDisk.partitionRole ?? '') &&
      !activeDisk.device?.startsWith('/dev/')
        ? 'No drive letter'
        : 'Not mounted');

  return (
    <ServerGlassPanel padding={insets(0)} radius={24} ariaLabel="Storage">
      <Row
        align="stretch"
        gapPx={0}
        style={{ layout: { width: pct(100), minHeight: px(340), position: 'relative', zIndex: 2 } }}
      >
        <ScrollView
          role="tree"
          ariaLabel="Disks and volumes"
          orientation="vertical"
          style={{
            layout: {
              width: px(268),
              flexShrink: 0,
              maxHeight: px(520),
            },
          }}
        >
          <Stack gapPx={3} style={{ layout: { width: pct(100), padding: insets(14, 10) } }}>
            {visible.map((item, index) => {
              const selected = item.id === activeDisk.id;
              const depth = serverDiskDepth(item, disks);
              const hasChildren = (childCountById.get(item.id) ?? 0) > 0;
              const expanded = hasChildren && !collapsed.has(item.id);
              const displayName = serverDiskDisplayName(item);

              return (
                <Row
                  key={item.id}
                  role="treeitem"
                  ariaSelected={selected}
                  ariaExpanded={hasChildren ? expanded : undefined}
                  ariaLevel={depth + 1}
                  align="center"
                  gapPx={2}
                  style={{
                    layout: {
                      width: pct(100),
                      padding: insets(3, 6, 3, 6 + depth * 13),
                    },
                    material: new SolidMaterial(selected ? colorToken('soft') : transparentColor),
                    corners: corners(12),
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' && visible[index + 1]) {
                      event.preventDefault();
                      selectDisk(visible[index + 1]!.id);
                    } else if (event.key === 'ArrowUp' && visible[index - 1]) {
                      event.preventDefault();
                      selectDisk(visible[index - 1]!.id);
                    } else if (event.key === 'Home' && visible[0]) {
                      event.preventDefault();
                      selectDisk(visible[0].id);
                    } else if (event.key === 'End' && visible.at(-1)) {
                      event.preventDefault();
                      selectDisk(visible.at(-1)!.id);
                    } else if (event.key === 'ArrowRight') {
                      event.preventDefault();
                      if (hasChildren && !expanded) toggleCollapse(item.id);
                      else {
                        const firstChild = visible.find((c) => c.parentId === item.id);
                        if (firstChild) selectDisk(firstChild.id);
                      }
                    } else if (event.key === 'ArrowLeft') {
                      event.preventDefault();
                      if (expanded) toggleCollapse(item.id);
                      else if (item.parentId) selectDisk(item.parentId);
                    }
                  }}
                >
                  {hasChildren ? (
                    <Pressable
                      ariaLabel={`${expanded ? 'Collapse' : 'Expand'} ${displayName}`}
                      ariaExpanded={expanded}
                      stopPropagation
                      onActivate={() => toggleCollapse(item.id)}
                      style={{
                        layout: {
                          width: px(20),
                          height: px(24),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        },
                        material: new SolidMaterial(transparentColor),
                        border: { width: 0, style: 'none', color: transparentColor },
                        corners: corners(6),
                      }}
                    >
                      <UiIcon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
                    </Pressable>
                  ) : (
                    <Box style={{ layout: { width: px(20), height: px(24), flexShrink: 0 } }} />
                  )}

                  <Pressable
                    ariaSelected={selected}
                    onActivate={() => selectDisk(item.id)}
                    style={{
                      layout: {
                        display: 'flex',
                        direction: 'row',
                        alignItems: 'center',
                        gap: px(9),
                        flexGrow: 1,
                        minWidth: px(0),
                        padding: insets(6, 6),
                      },
                      material: new SolidMaterial(transparentColor),
                      border: { width: 0, style: 'none', color: transparentColor },
                      corners: corners(10),
                      states: {
                        hover: {
                          material: new SolidMaterial(colorToken('surfaceHover')),
                        },
                      },
                    }}
                  >
                    <ServerDiskGlyph disk={item} size={16} />
                    <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Text
                        size={12.5}
                        weight={selected ? 600 : 500}
                        tone={selected ? 'primary' : 'muted'}
                        style={{ typography: { size: 12.5, maxLines: 1, align: 'left' } }}
                      >
                        {displayName}
                      </Text>
                      <Text
                        size={10.5}
                        tone="muted"
                        style={{
                          typography: { size: 10.5, maxLines: 1, align: 'left', tabularNums: true },
                        }}
                      >
                        {serverDiskTreeSubtitle(item)}
                      </Text>
                    </Stack>
                  </Pressable>
                </Row>
              );
            })}
          </Stack>
        </ScrollView>

        <Box
          ariaHidden
          style={{
            layout: { width: px(1), alignSelf: 'stretch' },
            material: new SolidMaterial(colorToken('border')),
          }}
        />

        <Box
          key={activeDisk.id}
          motion={{
            initial: { opacity: 0, y: 4 },
            animate: { opacity: 1, y: 0 },
            durationMs: 160,
            ease: 'easeOut',
          }}
          style={{
            layout: {
              display: 'flex',
              direction: 'column',
              gap: px(20),
              flexGrow: 1,
              minWidth: px(0),
              padding: insets(24),
            },
          }}
        >
          {lastKnown && (
            <Text size={11} tone="muted" weight={500}>
              Last known
            </Text>
          )}

          <Row align="center" justify="between" gapPx={14} style={{ layout: { width: pct(100) } }}>
            <Row align="center" gapPx={14} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
              <Box
                style={{
                  layout: {
                    width: px(54),
                    height: px(54),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    position: 'relative',
                    overflow: 'hidden',
                  },
                  material: new SolidMaterial(colorToken('soft')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(16),
                }}
              >
                <ServerDiskGlyph disk={activeDisk} size={26} />
                <GlassRim preset="medium" radiusPx={15} opacity={0.56} />
              </Box>
              <Stack gapPx={3} style={{ layout: { minWidth: px(0) } }}>
                <Heading level={4} size={17} weight={600}>
                  {serverDiskDisplayName(activeDisk)}
                </Heading>
                <Text size={11.5} tone="muted">
                  {[mediaLabel, activeDisk.filesystem, activeDisk.mountpoint]
                    .filter(Boolean)
                    .join(' · ') || 'Storage device'}
                </Text>
              </Stack>
            </Row>
            <Text
              size={22}
              weight={500}
              style={{ typography: { size: 22, letterSpacing: -0.02, tabularNums: true } }}
            >
              {formatBytes(activeDisk.totalBytes)}
            </Text>
          </Row>

          <ServerDiskSpaceBar disk={activeDisk} disks={disks} onSelectVolume={selectDisk} />

          <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
            {mediaLabel && <ServerFactRow label="Storage media" value={mediaLabel} />}
            {activeDisk.removable !== undefined && (
              <ServerFactRow label="Removable media" value={activeDisk.removable ? 'Yes' : 'No'} />
            )}
            {activeDisk.hotplug !== undefined && (
              <ServerFactRow
                label="Hot-plug connection"
                value={activeDisk.hotplug ? 'Yes' : 'No'}
              />
            )}
            {purposeLabel && <ServerFactRow label="Purpose" value={purposeLabel} />}
            {activeDisk.partitionNumber !== undefined && (
              <ServerFactRow label="Partition" value={String(activeDisk.partitionNumber)} />
            )}
            {activeDisk.device && <ServerFactRow label="Device" value={activeDisk.device} />}
            <ServerFactRow
              label={(activeDisk.mountpoints?.length ?? 0) > 1 ? 'Mount points' : 'Mount point'}
              value={mountDisplay}
            />
            {activeDisk.readOnly !== undefined && (
              <ServerFactRow
                label="Device access"
                value={activeDisk.readOnly ? 'Read only' : 'Read and write'}
              />
            )}
            <ServerFactRow label="Format" value={activeDisk.filesystem || 'Not reported'} />
            <ServerFactRow label="Capacity" value={formatBytes(activeDisk.totalBytes)} />
            <ServerFactRow
              label="Reporting scope"
              value={effectiveScope === 'container' ? 'Container volume' : 'Server'}
            />
          </Stack>
        </Box>
      </Row>
    </ServerGlassPanel>
  );
}
