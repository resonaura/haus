/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Children, isValidElement, type ReactNode } from 'react';
import { colorToken, corners, insets, pct, px } from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import { Box, Grid, Heading, Pressable, Text } from '../primitives/elements.js';
import { UiIcon } from './icon.js';

export {
  CameraOfflineOverlay,
  CameraPreviewTile,
  formatSnapshotAge,
  SnapshotAge,
  snapshotAgeSeconds,
  type CameraPreviewTileProps,
} from './cameras/preview-tile.js';

export function DashboardGrid({ columns, children }: { columns: number; children: ReactNode }) {
  const items = Children.toArray(children);
  const keys = items.map((item) =>
    isValidElement(item) && item.key !== null ? String(item.key) : '',
  );
  const canAnimateLayout = keys.length > 0 && keys.every((key) => key.length > 0);
  const layoutSignature = canAnimateLayout ? `${columns}:${keys.join('|')}` : undefined;
  return (
    <Grid columns={columns} gapPx={11}>
      {layoutSignature
        ? items.map((item, idx) => (
            <Box
              key={keys[idx]}
              layoutTransition={layoutSignature}
              style={{ layout: { width: pct(100), minWidth: px(0) } }}
            >
              {item}
            </Box>
          ))
        : children}
    </Grid>
  );
}

export function AttentionBanner({
  titles,
  count,
  onOpen,
  portable = false,
}: {
  titles: readonly string[];
  count: number;
  onOpen: () => void;
  portable?: boolean;
}) {
  return (
    <Pressable
      className="attention-banner"
      onActivate={onOpen}
      style={
        portable
          ? {
              layout: {
                direction: 'row',
                alignItems: 'center',
                gap: px(13),
                minHeight: px(66),
                padding: insets(12, 16),
                margin: insets(0, 0, 25, 0),
              },
              border: { width: 1, color: colorToken('border') },
              material: new SolidMaterial(colorToken('card')),
              corners: corners(15),
            }
          : undefined
      }
    >
      <Text className="attention-icon">
        <UiIcon name="bell" size={20} />
      </Text>
      <Box
        style={{
          layout: {
            display: 'flex',
            direction: 'column',
            flexGrow: 1,
            gap: px(portable ? 3 : 5),
          },
        }}
      >
        <Text semantic="strong" size={portable ? 12 : undefined}>
          A few things to check
        </Text>
        <Text
          semantic="small"
          tone={portable ? 'muted' : undefined}
          size={portable ? 10 : undefined}
        >
          {titles.join(' · ')}
        </Text>
      </Box>
      <Text className="attention-count" size={portable ? 10 : undefined}>
        {count}
      </Text>
      <UiIcon name="chevron-right" size={19} />
    </Pressable>
  );
}

export function RoomSection({
  name,
  caption,
  icon,
  onOpen,
  children,
  portable = true,
}: {
  name: string;
  caption: string;
  icon?: ReactNode;
  onOpen?: () => void;
  children: ReactNode;
  portable?: boolean;
}) {
  return (
    <Box
      semantic="section"
      className="device-group home-room-section"
      style={portable ? { layout: { gap: px(11), margin: insets(0, 0, 23, 0) } } : undefined}
    >
      <Box
        className="device-group-heading"
        style={
          portable ? { layout: { direction: 'row', alignItems: 'center', gap: px(11) } } : undefined
        }
      >
        {icon}
        {portable && onOpen ? (
          <Pressable
            className="group-room-link"
            onActivate={onOpen}
            style={{ layout: { direction: 'row', alignItems: 'center', gap: px(5) } }}
          >
            <Heading level={2} size={20}>
              {name}
            </Heading>
            <UiIcon name="chevron-right" size={14} />
          </Pressable>
        ) : (
          <Heading level={2} size={portable ? 20 : undefined}>
            {onOpen ? (
              <Pressable className="group-room-link" onActivate={onOpen}>
                {name}
                <UiIcon name="chevron-right" size={14} />
              </Pressable>
            ) : (
              name
            )}
          </Heading>
        )}
        <Text
          className="device-group-count"
          tone={portable ? 'muted' : undefined}
          size={portable ? 10 : undefined}
        >
          {caption}
        </Text>
        {portable ? (
          <Box
            style={{
              layout: { flexGrow: 1, height: px(1) },
              material: new SolidMaterial(colorToken('border')),
            }}
          />
        ) : (
          <Text className="device-group-rule" />
        )}
      </Box>
      {children}
    </Box>
  );
}
