/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { formatBytes, type ServerDiskRecord } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, Heading, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { UiIcon } from '../icon.js';
import { ServerFactRow, ServerGlassPanel } from './server-surfaces.js';
import { ServerDiskSpaceBar } from './server-visuals.js';

/** Electron-matched master-detail Disks workspace inside a single Liquid Glass panel. */
export function ServerDisksTab({
  disks,
  reportingScope,
}: {
  readonly disks: readonly ServerDiskRecord[];
  readonly reportingScope?: 'host' | 'container';
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const activeDisk = disks.find((d) => d.id === selectedId) ?? disks[0];

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

  return (
    <ServerGlassPanel padding={insets(0)} radius={24} ariaLabel="Storage">
      <Row
        align="stretch"
        gapPx={0}
        style={{ layout: { width: pct(100), minHeight: px(320), position: 'relative', zIndex: 2 } }}
      >
        <Stack
          gapPx={3}
          style={{
            layout: {
              width: px(252),
              flexShrink: 0,
              padding: insets(14, 10),
            },
          }}
        >
          {disks.map((disk) => {
            const selected = disk.id === activeDisk.id;
            return (
              <Pressable
                key={disk.id}
                ariaSelected={selected}
                onActivate={() => setSelectedId(disk.id)}
                style={{
                  layout: {
                    display: 'flex',
                    direction: 'row',
                    alignItems: 'center',
                    gap: px(10),
                    width: pct(100),
                    padding: insets(10, 10),
                  },
                  material: new SolidMaterial(selected ? colorToken('soft') : transparentColor),
                  border: { width: 0, style: 'none', color: transparentColor },
                  corners: corners(12),
                  states: {
                    hover: {
                      material: new SolidMaterial(colorToken('surfaceHover')),
                    },
                  },
                }}
              >
                <UiIcon name="hard-drive" size={16} />
                <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                  <Text
                    size={12.5}
                    weight={selected ? 600 : 500}
                    tone={selected ? 'primary' : 'muted'}
                    style={{ typography: { size: 12.5, maxLines: 1, align: 'left' } }}
                  >
                    {disk.name}
                  </Text>
                  <Text
                    size={10.5}
                    tone="muted"
                    style={{
                      typography: { size: 10.5, maxLines: 1, align: 'left', tabularNums: true },
                    }}
                  >
                    {[disk.mountpoint, formatBytes(disk.totalBytes)].filter(Boolean).join(' · ')}
                  </Text>
                </Stack>
              </Pressable>
            );
          })}
        </Stack>

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
                <UiIcon name="hard-drive" size={26} />
                <GlassRim preset="medium" radiusPx={15} opacity={0.56} />
              </Box>
              <Stack gapPx={3} style={{ layout: { minWidth: px(0) } }}>
                <Heading level={4} size={17} weight={600}>
                  {activeDisk.name}
                </Heading>
                <Text size={11.5} tone="muted">
                  {[activeDisk.filesystem, activeDisk.mountpoint].filter(Boolean).join(' · ') ||
                    'Storage volume'}
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

          <ServerDiskSpaceBar disk={activeDisk} />

          <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
            <ServerFactRow label="Mount point" value={activeDisk.mountpoint || 'Not mounted'} />
            <ServerFactRow label="Format" value={activeDisk.filesystem || 'Not reported'} />
            <ServerFactRow label="Capacity" value={formatBytes(activeDisk.totalBytes)} />
            <ServerFactRow label="Used" value={formatBytes(activeDisk.usedBytes)} />
            <ServerFactRow label="Available" value={formatBytes(activeDisk.availableBytes)} />
            <ServerFactRow
              label="Reporting scope"
              value={reportingScope === 'container' ? 'Container volume' : 'Server'}
            />
          </Stack>
        </Box>
      </Row>
    </ServerGlassPanel>
  );
}
