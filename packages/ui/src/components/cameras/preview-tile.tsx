/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { BackdropMaterial, GradientMaterial, SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  Pressable,
  Row,
  Stack,
  Text,
  type PressableProps,
} from '../../primitives/elements.js';
import { useHausUi } from '../../primitives/context.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { ProgressiveBlur } from '../../primitives/media.js';
import { UiIcon } from '../icon.js';
import { cameraGlass, cameraPreviewCorners } from './surfaces.js';

/** Age of the last successfully displayed snapshot, not the last polling attempt. */
export function snapshotAgeSeconds(updatedAt: number, now: number): number | undefined {
  return updatedAt > 0 && Number.isFinite(updatedAt) && Number.isFinite(now)
    ? Math.max(0, Math.floor((now - updatedAt) / 1000))
    : undefined;
}

/** One compact unit keeps old-frame badges readable without widening camera tiles. */
export function formatSnapshotAge(seconds: number): string {
  for (const [duration, suffix] of [
    [365 * 86_400, 'y'],
    [30 * 86_400, 'mo'],
    [86_400, 'd'],
    [3600, 'h'],
    [60, 'm'],
  ] as const) {
    if (seconds >= duration) return `${Math.floor(seconds / duration)}${suffix}`;
  }
  return `${Math.max(0, Math.floor(seconds))}s`;
}

export function SnapshotAge({ updatedAt }: { readonly updatedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!updatedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [updatedAt]);
  const seconds = snapshotAgeSeconds(updatedAt, Math.max(now, updatedAt));
  if (seconds === undefined) {
    return (
      <Text
        size={10}
        weight={500}
        style={{ typography: { color: rgba(248, 248, 248, 0.94), tabularNums: true } }}
      >
        —
      </Text>
    );
  }
  return (
    <Text
      semantic="time"
      dateTime={new Date(updatedAt).toISOString()}
      title={`${seconds} seconds since Haus received the snapshot`}
      size={10}
      weight={500}
      style={{ typography: { color: rgba(248, 248, 248, 0.94), tabularNums: true } }}
    >
      {formatSnapshotAge(seconds)}
    </Text>
  );
}

export function CameraOfflineOverlay({
  offline,
  exiting = false,
}: {
  readonly offline: boolean;
  readonly exiting?: boolean;
}) {
  const visible = offline && !exiting;
  return (
    <>
      <Box
        ariaHidden
        motion={{
          initial: { opacity: visible ? 1 : 0 },
          animate: { opacity: visible ? 1 : 0 },
          durationMs: 420,
          ease: 'easeOut',
        }}
        style={{
          layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
          pointerEvents: 'none',
          corners: cameraPreviewCorners,
          material: new BackdropMaterial(
            { blurRadius: 14, saturation: 0.9, tintColor: rgba(8, 10, 14, 0.28) },
            { fallbackColor: rgba(14, 16, 20, 0.72) },
          ),
        }}
      />
      <Box
        role="img"
        ariaLabel="Camera offline"
        motion={{
          initial: { opacity: visible ? 1 : 0, scale: visible ? 1 : 1.04 },
          animate: { opacity: visible ? 1 : 0, scale: visible ? 1 : 1.04 },
          durationMs: 320,
          ease: visible ? 'easeOut' : 'easeIn',
        }}
        style={{
          layout: {
            position: 'absolute',
            inset: insets(0),
            width: pct(100),
            height: pct(100),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3,
          },
          pointerEvents: 'none',
        }}
      >
        <Box
          style={{
            layout: {
              width: px(56),
              height: px(56),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
            corners: corners(999, 'round'),
            material: new GradientMaterial(
              [
                { offset: 0, color: rgba(0, 0, 0, 0.34) },
                { offset: 1, color: rgba(0, 0, 0, 0) },
              ],
              180,
              'radial',
              undefined,
              { shape: 'circle', centerX: 0.5, centerY: 0.5, radiusX: 0.5, radiusY: 0.5 },
            ),
          }}
        >
          <UiIcon name="video-off" size={32} color="rgba(255, 255, 255, 0.92)" />
        </Box>
      </Box>
    </>
  );
}

export interface CameraPreviewTileProps {
  readonly id?: string;
  readonly name: string;
  readonly status?: ReactNode;
  readonly updatedAt?: number;
  readonly demo?: boolean;
  readonly offline?: boolean;
  readonly loading?: boolean;
  readonly recovering?: boolean;
  readonly preview?: ReactNode;
  readonly label?: string;
  readonly room?: string;
  readonly alwaysShowLabel?: boolean;
  readonly pressableRef?: PressableProps['pressableRef'];
  readonly onSecondaryPress?: () => void;
  readonly onOpen: () => void;
}

/**
 * Shared 1:1 desktop camera preview card across Electron DOM and GPUIX Metal.
 * Keeps imagery unobstructed at rest; reveals bottom progressive blur, shade,
 * room/title label, and expand arrow smoothly on hover/focus; renders the
 * always-visible frosted live-age counter pill, frosted offline overlay, and
 * analytical Liquid Glass rim lighting.
 */
export function CameraPreviewTile({
  id,
  name,
  status,
  updatedAt,
  demo = false,
  offline = false,
  loading = false,
  recovering = false,
  preview,
  label,
  room,
  alwaysShowLabel = false,
  pressableRef,
  onSecondaryPress,
  onOpen,
}: CameraPreviewTileProps) {
  const ctx = useHausUi();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const revealMeta = Boolean(alwaysShowLabel || hovered || focused);
  const showOfflineOverlay = offline || recovering;
  // DOM clips scaled media to rounded corners; GPUI overflow:hidden clips rectangularly.
  const canClipScaledMedia = ctx.contentHost === ctx.host;
  const mediaScale = !canClipScaledMedia ? 1 : offline ? 1.05 : hovered && preview ? 1.04 : 1;

  const badgePrimary =
    status !== undefined ? (
      status
    ) : demo ? (
      <Text
        size={10}
        weight={500}
        style={{ typography: { color: rgba(248, 248, 248, 0.94), tabularNums: true } }}
      >
        Preview
      </Text>
    ) : (
      <SnapshotAge updatedAt={updatedAt ?? 0} />
    );

  return (
    <Pressable
      id={id}
      className={`camera-card ${recovering ? 'is-recovering-preview' : ''}`}
      dataAttrs={{ 'data-haus-glass-rim': 'managed', 'data-haus-camera-tile': 'shared' }}
      pressableRef={pressableRef}
      ariaLabel={`Open ${name}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onSecondaryPress={onSecondaryPress}
      onActivate={onOpen}
      style={{
        layout: {
          display: 'flex',
          direction: 'column',
          width: pct(100),
          minHeight: px(124),
          aspectRatio: 16 / 9,
          position: 'relative',
          overflow: 'hidden',
          justifyContent: 'between',
          padding: insets(10, 12, 14, 16),
        },
        material: new SolidMaterial(colorToken('surfaceHover')),
        border: { width: 1, color: rgba(255, 255, 255, 0.06) },
        shadows: [{ offsetX: 0, offsetY: 3, blurRadius: 12, color: rgba(0, 0, 0, 0.08) }],
        corners: cameraPreviewCorners,
      }}
    >
      <Box
        ariaHidden
        style={{
          layout: {
            position: 'absolute',
            inset: insets(0),
            width: pct(100),
            height: pct(100),
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
          corners: cameraPreviewCorners,
          pointerEvents: 'none',
        }}
      >
        {preview ? (
          <Box
            motion={{
              animate: { scale: mediaScale },
              durationMs: offline || recovering ? 420 : 560,
              ease: [0.2, 0.7, 0.2, 1],
            }}
            style={{
              layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
              pointerEvents: 'none',
            }}
          >
            {preview}
          </Box>
        ) : !offline ? (
          <UiIcon name="camera" size={27} />
        ) : null}
      </Box>

      {loading && !offline && preview && (
        <Box
          ariaHidden
          style={{
            layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
            pointerEvents: 'none',
            corners: cameraPreviewCorners,
            material: new BackdropMaterial(
              { blurRadius: 2.5, tintColor: rgba(0, 0, 0, 0.06) },
              { fallbackColor: rgba(0, 0, 0, 0) },
            ),
          }}
        />
      )}

      {showOfflineOverlay && (
        <CameraOfflineOverlay offline={offline} exiting={recovering && !offline} />
      )}

      {label && (
        <Box
          ariaHidden
          motion={{
            initial: { opacity: revealMeta ? 1 : 0 },
            animate: { opacity: revealMeta ? 1 : 0 },
            durationMs: 280,
            ease: 'easeOut',
          }}
          style={{
            layout: {
              position: 'absolute',
              inset: insets(0),
              width: pct(100),
              height: pct(100),
              zIndex: 2,
            },
            pointerEvents: 'none',
            corners: cameraPreviewCorners,
          }}
        >
          {preview && !offline && (
            <ProgressiveBlur
              maxRadius={12}
              start={0.38}
              style={{
                layout: {
                  position: 'absolute',
                  inset: insets(0),
                  width: pct(100),
                  height: pct(100),
                },
                corners: cameraPreviewCorners,
              }}
            />
          )}
          <Box
            ariaHidden
            style={{
              layout: {
                position: 'absolute',
                inset: insets(0),
                width: pct(100),
                height: pct(100),
              },
              pointerEvents: 'none',
              corners: cameraPreviewCorners,
              material: new GradientMaterial(
                [
                  { offset: 0.44, color: rgba(0, 0, 0, 0) },
                  { offset: 1, color: rgba(0, 0, 0, 0.56) },
                ],
                180,
              ),
            }}
          />
        </Box>
      )}

      <Row
        justify="end"
        style={{
          layout: { width: pct(100), position: 'relative', zIndex: 4 },
          pointerEvents: 'none',
        }}
      >
        <Row
          align="center"
          gapPx={7}
          style={{
            layout: { padding: insets(4, 8), minHeight: px(24) },
            material: cameraGlass(0.38),
            border: { width: 1, color: rgba(255, 255, 255, 0.1) },
            shadows: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: rgba(0, 0, 0, 0.12) }],
            corners: corners(9),
          }}
        >
          {badgePrimary}
          {offline && status === undefined && (
            <Text
              size={9}
              weight={500}
              style={{ typography: { color: rgba(255, 255, 255, 0.75) } }}
            >
              Offline
            </Text>
          )}
        </Row>
      </Row>

      {label ? (
        <Row
          justify="between"
          align="end"
          style={{
            layout: { width: pct(100), gap: px(8), position: 'relative', zIndex: 3 },
            pointerEvents: 'none',
          }}
        >
          <Box
            motion={{
              initial: { opacity: revealMeta ? 1 : 0, y: revealMeta ? 0 : 6 },
              animate: { opacity: revealMeta ? 1 : 0, y: revealMeta ? 0 : 6 },
              durationMs: 260,
              ease: [0.2, 0.7, 0.2, 1],
            }}
            style={{ layout: { minWidth: px(0), flexGrow: 1 } }}
          >
            <Stack gapPx={3} style={{ layout: { minWidth: px(0), width: pct(100) } }}>
              {room && (
                <Text
                  size={9}
                  weight={500}
                  style={{
                    typography: {
                      size: 9,
                      color: rgba(255, 255, 255, 0.72),
                      align: 'left',
                      maxLines: 1,
                    },
                  }}
                >
                  {room}
                </Text>
              )}
              <Text
                size={13}
                weight={600}
                style={{
                  typography: {
                    size: 13,
                    color: rgba(255, 255, 255, 0.96),
                    align: 'left',
                    maxLines: 1,
                  },
                }}
              >
                {label}
              </Text>
            </Stack>
          </Box>
          <Box
            motion={{
              initial: { opacity: revealMeta ? 1 : 0, x: revealMeta ? 0 : -3 },
              animate: { opacity: revealMeta ? 1 : 0, x: revealMeta ? 0 : -3 },
              durationMs: 240,
              ease: 'easeOut',
            }}
          >
            <UiIcon name="arrow-right" size={16} color="#ffffff" />
          </Box>
        </Row>
      ) : (
        <Box />
      )}

      <GlassRim preset="card" radiusPx={25} opacity={hovered ? 0.72 : 0.48} />
    </Pressable>
  );
}
