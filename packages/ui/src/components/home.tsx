/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { colorToken, corners, insets, pct, px, rgba } from '../ir/geometry.js';
import { GradientMaterial, SolidMaterial } from '../ir/materials.js';
import {
  Box,
  Grid,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  type PressableProps,
} from '../primitives/elements.js';
import { UiIcon } from './icon.js';

export function DashboardGrid({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <Grid columns={columns} gapPx={11}>
      {children}
    </Grid>
  );
}

export function CameraPreviewTile({
  id,
  name,
  status,
  preview,
  label,
  room,
  recovering,
  pressableRef,
  portable = true,
  onSecondaryPress,
  onOpen,
}: {
  id?: string;
  name: string;
  status: ReactNode;
  preview?: ReactNode;
  label?: string;
  room?: string;
  recovering?: boolean;
  pressableRef?: PressableProps['pressableRef'];
  portable?: boolean;
  onSecondaryPress?: () => void;
  onOpen: () => void;
}) {
  if (!portable) {
    return (
      <Pressable
        id={id}
        className={`camera-card ${recovering ? 'is-recovering-preview' : ''}`}
        pressableRef={pressableRef}
        ariaLabel={`Open ${name}`}
        onSecondaryPress={onSecondaryPress}
        onActivate={onOpen}
      >
        {preview}
        <Text className="camera-age-badge">{status}</Text>
        {label && (
          <>
            <Box className="camera-shade" ariaHidden />
            <Text className="camera-label">
              {room && (
                <Text semantic="small" className="camera-room-label">
                  {room}
                </Text>
              )}
              {label}
            </Text>
            <Text className="camera-expand">
              <UiIcon name="arrow-right" size={17} />
            </Text>
          </>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      id={id}
      className={`camera-card ${recovering ? 'is-recovering-preview' : ''}`}
      pressableRef={pressableRef}
      ariaLabel={`Open ${name}`}
      onSecondaryPress={onSecondaryPress}
      onActivate={onOpen}
      style={{
        layout: {
          width: pct(100),
          minHeight: px(124),
          aspectRatio: 16 / 9,
          position: 'relative',
          overflow: 'hidden',
          justifyContent: 'between',
          padding: insets(10, 12, 12, 14),
        },
        material: new SolidMaterial(colorToken('surfaceHover')),
        border: { width: 1, color: rgba(255, 255, 255, 0.06) },
        corners: corners(17),
      }}
    >
      {preview && (
        <Box
          ariaHidden
          style={{
            layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
            pointerEvents: 'none',
          }}
        >
          {preview}
        </Box>
      )}
      <Box
        ariaHidden
        style={{
          layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
          pointerEvents: 'none',
          material: new GradientMaterial(
            [
              { offset: 0.38, color: rgba(0, 0, 0, 0) },
              { offset: 1, color: rgba(0, 0, 0, 0.68) },
            ],
            180,
          ),
        }}
      />
      <Row justify="end" style={{ layout: { width: pct(100) }, pointerEvents: 'none' }}>
        <Text
          className="camera-age-badge"
          size={10}
          weight={500}
          style={{
            layout: { padding: insets(5, 8) },
            material: new SolidMaterial(rgba(12, 12, 12, 0.42)),
            border: { width: 1, color: rgba(255, 255, 255, 0.1) },
            corners: corners(9),
            typography: { size: 10, color: rgba(248, 248, 248, 0.94) },
          }}
        >
          {status}
        </Text>
      </Row>
      {label ? (
        <Row
          justify="between"
          align="end"
          style={{ layout: { width: pct(100), gap: px(8) }, pointerEvents: 'none' }}
        >
          <Stack gapPx={2} style={{ layout: { minWidth: px(0), flexGrow: 1 } }}>
            {room && (
              <Text
                size={8}
                weight={600}
                style={{ typography: { size: 8, letterSpacing: 0.14, color: rgba(255, 255, 255, 0.74) } }}
              >
                {room.toUpperCase()}
              </Text>
            )}
            <Text
              size={13}
              weight={600}
              style={{ typography: { size: 13, color: rgba(255, 255, 255, 0.96), maxLines: 1 } }}
            >
              {label}
            </Text>
          </Stack>
          <UiIcon name="arrow-right" size={16} color="#ffffff" />
        </Row>
      ) : (
        <Box />
      )}
    </Pressable>
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
      <Box style={portable ? { layout: { flexGrow: 1, gap: px(3) } } : undefined}>
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
