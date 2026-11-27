/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { formatBytes, type HausStorageUsageRecord } from '@haus/core/transport';
import {
  colorToken,
  corners,
  insets,
  pct,
  px,
  rgba,
  transparentColor,
} from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import { useHausUi } from '../../../primitives/context.js';
import { Box, Heading, Pressable, Row, Stack, Text } from '../../../primitives/index.js';
import { UiIcon } from '../../icon.js';
import type { UiIconName } from '../../icons.js';
import { ServerGlassPanel } from '../server-surfaces.js';

const STORAGE_CATEGORIES: Readonly<Record<string, readonly [string, UiIconName]>> = {
  originals: ['Original Recordings', 'video'],
  prepared: ['Prepared Playback', 'file-video'],
  prebuffer: ['Pre-event Buffer', 'timer'],
  snapshots: ['Snapshots & Thumbnails', 'image'],
  'ha-backups': ['Home Assistant Backups', 'archive'],
  'config-backups': ['Configuration Backups', 'archive'],
  databases: ['Databases', 'database'],
  logs: ['Logs', 'files'],
  configuration: ['Configuration', 'settings-2'],
  capture: ['Capture in Progress', 'video'],
  preparation: ['Playback Preparation', 'file-video'],
  'stream-cache': ['Stream Cache', 'radio'],
  temporary: ['Temporary Files', 'timer'],
  'other-media': ['Unclassified Media', 'file-video'],
  shared: ['Shared Files', 'layers'],
  other: ['Other Haus Files', 'files'],
};

export function HausStorageUsageCard({
  usage,
  online,
}: {
  readonly usage: HausStorageUsageRecord | null | undefined;
  readonly online: boolean;
}) {
  const { theme } = useHausUi();
  const isDark = theme.mode === 'dark';
  const [aboutOpen, setAboutOpen] = useState(false);
  const rows =
    usage?.categories
      .filter((row) => Number.isFinite(row.logicalBytes) && row.logicalBytes >= 0)
      .slice()
      .sort((a, b) => b.logicalBytes - a.logicalBytes) ?? [];
  const stale = Boolean(usage) && (!online || Date.now() - usage!.sampledAt > 90_000);
  const measuring = online && usage === null;

  return (
    <ServerGlassPanel padding={insets(24)} radius={24} ariaLabel="Haus Storage">
      <Row
        align="center"
        justify="between"
        style={{ layout: { width: pct(100), margin: insets(0, 0, 14, 0) } }}
      >
        <Row align="center" gapPx={9}>
          <UiIcon name="hard-drive" size={17} />
          <Heading level={3} size={15} weight={600}>
            Haus Storage
          </Heading>
        </Row>
        {usage && (
          <Text size={13} weight={600} style={{ typography: { tabularNums: true } }}>
            {`${!usage.complete ? '≥ ' : ''}${formatBytes(usage.logicalBytes)}`}
          </Text>
        )}
      </Row>

      {!usage ? (
        <Text size={12.5} tone="muted">
          {measuring
            ? 'Measuring files managed by Haus…'
            : 'This server has not reported storage measurements yet.'}
        </Text>
      ) : (
        <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
          {Boolean(usage.logicalBytes && usage.logicalBytes > 0) && (
            <Row
              gapPx={2}
              role="group"
              ariaLabel="Haus file size by component"
              style={{
                layout: { width: pct(100), height: px(10), overflow: 'hidden' },
                material: new SolidMaterial(colorToken('soft')),
                corners: corners(999, 'round'),
              }}
            >
              {rows.map((row, index) => {
                const pctWidth = Math.max(
                  0.5,
                  (row.logicalBytes / Math.max(1, usage.logicalBytes ?? 1)) * 100,
                );
                const alpha = 0.3 + (index % 5) * 0.14;
                const fill = isDark ? rgba(255, 255, 255, alpha) : rgba(24, 24, 27, alpha);
                const [label] = STORAGE_CATEGORIES[row.id] ?? STORAGE_CATEGORIES.other!;
                return (
                  <Box
                    key={row.id}
                    title={`${label}: ${formatBytes(row.logicalBytes)}`}
                    style={{
                      layout: { width: pct(pctWidth), height: pct(100) },
                      material: new SolidMaterial(fill),
                    }}
                  />
                );
              })}
            </Row>
          )}

          <Row
            align="center"
            justify="between"
            style={{ layout: { width: pct(100), padding: insets(2, 0) } }}
          >
            <Text size={11} tone="muted" weight={600} style={{ layout: { flexGrow: 1 } }}>
              Component
            </Text>
            <Text
              size={11}
              tone="muted"
              weight={600}
              style={{ layout: { width: px(96) }, typography: { align: 'right' } }}
            >
              File Size
            </Text>
            <Text
              size={11}
              tone="muted"
              weight={600}
              style={{ layout: { width: px(96) }, typography: { align: 'right' } }}
            >
              Allocated
            </Text>
          </Row>

          <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
            {rows.map((row) => {
              const [label, iconName] = STORAGE_CATEGORIES[row.id] ?? STORAGE_CATEGORIES.other!;
              return (
                <Row
                  key={row.id}
                  align="center"
                  justify="between"
                  style={{ layout: { width: pct(100), padding: insets(4, 0) } }}
                >
                  <Row
                    align="center"
                    gapPx={8}
                    style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                  >
                    <UiIcon name={iconName} size={14} />
                    <Text size={12.5}>{label}</Text>
                  </Row>
                  <Text
                    size={12}
                    tone="muted"
                    style={{
                      layout: { width: px(96) },
                      typography: { align: 'right', tabularNums: true },
                    }}
                  >
                    {formatBytes(row.logicalBytes)}
                  </Text>
                  <Text
                    size={12}
                    tone="muted"
                    style={{
                      layout: { width: px(96) },
                      typography: { align: 'right', tabularNums: true },
                    }}
                  >
                    {formatBytes(row.allocatedBytes)}
                  </Text>
                </Row>
              );
            })}

            <Box
              ariaHidden
              style={{
                layout: { width: pct(100), height: px(1), margin: insets(2, 0) },
                material: new SolidMaterial(colorToken('border')),
              }}
            />

            <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
              <Text size={12.5} weight={600} style={{ layout: { flexGrow: 1 } }}>
                {`Total${stale ? ' · Last Known' : !usage.complete ? ' · Partial' : ''}`}
              </Text>
              <Text
                size={12.5}
                weight={600}
                style={{
                  layout: { width: px(96) },
                  typography: { align: 'right', tabularNums: true },
                }}
              >
                {`${!usage.complete ? '≥ ' : ''}${formatBytes(usage.logicalBytes)}`}
              </Text>
              <Text
                size={12.5}
                weight={600}
                style={{
                  layout: { width: px(96) },
                  typography: { align: 'right', tabularNums: true },
                }}
              >
                {`${!usage.complete && usage.allocatedBytes !== null ? '≥ ' : ''}${formatBytes(usage.allocatedBytes)}`}
              </Text>
            </Row>
          </Stack>

          {!usage.complete && (
            <Text size={11.5} tone="muted">
              Some files could not be measured. These totals show at least the reported amount.
            </Text>
          )}

          <Row align="center" justify="between" wrap gapPx={8}>
            <Text size={11} tone="muted">
              {`${stale ? 'Last measured' : 'Measured'} ${new Date(usage.sampledAt).toLocaleTimeString()} · Updates in the background`}
            </Text>
            <Pressable
              onActivate={() => setAboutOpen((prev) => !prev)}
              style={{
                layout: { padding: insets(2, 4) },
                material: new SolidMaterial(transparentColor),
                border: { width: 0, style: 'none', color: transparentColor },
              }}
            >
              <Text size={11} tone="muted" weight={500}>
                {aboutOpen ? 'Hide details' : 'About these measurements'}
              </Text>
            </Pressable>
          </Row>

          {aboutOpen && (
            <Text size={11.5} tone="muted" style={{ typography: { lineHeight: 1.48 } }}>
              Across this server’s Haus storage locations, separate from total disk usage.
              Hard-linked files count once; files used by multiple components appear as Shared
              Files. Allocated blocks can share physical storage through compression or snapshots.
              Container images and external service logs are outside these totals.
            </Text>
          )}
        </Stack>
      )}
    </ServerGlassPanel>
  );
}
