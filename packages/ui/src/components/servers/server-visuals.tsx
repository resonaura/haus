/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

// DuoBar gauge geometry adapted from DuoBar (MIT), copyright (c) 2026 Mike Li.
// Source: Mikeli7666/DuoBar @ 06a70af414737c0b0f6bb0985f5027e29f1377bf.
// See THIRD_PARTY_NOTICES/DuoBar.txt.

import { memo } from 'react';
import {
  formatBytes,
  formatRatio,
  type ServerDiskRecord,
  type ServerResourceSample,
} from '@haus/core/transport';
import { colorToken, corners, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { useHausUi } from '../../primitives/context.js';
import { Box, Pressable, Row, Stack, Text } from '../../primitives/elements.js';
import { VectorGraphic } from '../../primitives/media.js';
import { resolveColorToCss } from '../../renderers/contract.js';

const GAUGE_DIAMETER = 26.5;
const GAUGE_STROKE = GAUGE_DIAMETER * (18 / 230);
const GAUGE_RADIUS = (GAUGE_DIAMETER - GAUGE_STROKE) / 2;

function gaugePoint(degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  return `${(16 + Math.cos(radians) * GAUGE_RADIUS).toFixed(2)},${(15.2 + Math.sin(radians) * GAUGE_RADIUS).toFixed(2)}`;
}

export function duoUsageArc(progress: number): string {
  const end = 150.1 + (389.9 - 150.1) * Math.min(1, Math.max(0, progress));
  return Array.from(
    { length: 73 },
    (_, index) => `${index === 0 ? 'M' : 'L'}${gaugePoint(150.1 + ((end - 150.1) * index) / 72)}`,
  ).join(' ');
}

export const DUO_USAGE_GEOMETRY = {
  stroke: GAUGE_STROKE,
  arc: duoUsageArc(1),
  dotRadius: 2.477173913 / 2,
  dots: [4, 3, 2, 1].map((index) => {
    const angle = ((29.9 + (120.2 * index) / 5) * Math.PI) / 180;
    return {
      x: 16 + Math.cos(angle) * GAUGE_RADIUS,
      y: 15.2 + Math.sin(angle) * GAUGE_RADIUS,
    };
  }),
  inactiveOpacity: 0.3,
} as const;

export function computeServiceUsageScore(
  cpuPercent: number | null,
  memoryBytes: number | null,
  totalMemoryBytes: number | null,
): number | null {
  const cpuRatio = formatRatio(cpuPercent, 100);
  const memRatio = formatRatio(memoryBytes, totalMemoryBytes);
  if (cpuRatio === null && memRatio === null) return null;
  return Math.min(1, Math.max(cpuRatio ?? 0, (memRatio ?? 0) * 0.85));
}

/**
 * Electron-matched rolling 60-second sparkline rendered identically in DOM and GPUI.
 * Uses the newest sample timestamp to gently slide incoming points from the right edge.
 */
export const ServerSparkline = memo(function ServerSparkline({
  history,
  field,
}: {
  readonly history: readonly ServerResourceSample[];
  readonly field: 'cpu' | 'memory' | 'swap';
}) {
  const { theme } = useHausUi();
  const lastTime = history.at(-1)?.time;
  const step = 200 / 60;
  const parts: string[] = [];
  let continuous = false;
  let previousSampleTime: number | undefined;

  for (const sample of history) {
    if (lastTime === undefined || sample.time < lastTime - 62_000) continue;
    const value = sample[field];
    if (value === null) {
      continuous = false;
      continue;
    }
    if (previousSampleTime !== undefined && sample.time - previousSampleTime > 10_000) {
      continuous = false;
    }
    const x = 200 + step - ((lastTime - sample.time) / 1000) * step;
    const y = 36 - Math.min(1, Math.max(0, value)) * 31;
    parts.push(`${continuous ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`);
    previousSampleTime = sample.time;
    continuous = true;
  }

  if (parts.length < 2) return null;
  const strokeColor = resolveColorToCss(colorToken('textPrimary'), theme, false);

  return (
    <Box
      ariaHidden
      style={{
        layout: {
          position: 'absolute',
          inset: { bottom: px(5), left: px(18), right: px(18) },
          height: px(32),
          overflow: 'hidden',
        },
        opacity: 0.34,
        pointerEvents: 'none',
      }}
    >
      <Box
        key={lastTime}
        motion={{
          initial: { x: step },
          animate: { x: 0 },
          durationMs: 950,
          ease: 'linear',
        }}
        style={{ layout: { width: pct(100), height: pct(100) }, pointerEvents: 'none' }}
      >
        <VectorGraphic
          viewWidth={200}
          viewHeight={42}
          width="100%"
          height={32}
          preserveAspectRatio="none"
          ariaHidden
          stroke={strokeColor}
          strokeWidth={1.6}
          paths={[
            {
              d: parts.join(' '),
              fill: 'none',
              stroke: strokeColor,
              strokeWidth: 1.6,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              vectorEffect: 'non-scaling-stroke',
            },
          ]}
        />
      </Box>
    </Box>
  );
});

/** DuoBar-inspired compact gauge: independent CPU arc, 4 memory dots, and centered readout. */
export function ServerUsageGauge({
  cpuPercent,
  memoryBytes,
  totalMemoryBytes,
  inactive = false,
  size = 44,
}: {
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly totalMemoryBytes: number | null;
  readonly inactive?: boolean;
  readonly size?: number;
}) {
  const { theme } = useHausUi();
  const cpuRatio = formatRatio(cpuPercent, 100);
  const memRatio = formatRatio(memoryBytes, totalMemoryBytes);
  const usage = computeServiceUsageScore(cpuPercent, memoryBytes, totalMemoryBytes);
  const pressure = Math.max(cpuRatio ?? 0, memRatio ?? 0);
  const muted = inactive || usage === null;

  const gaugeColorToken = muted
    ? colorToken('textPrimary')
    : pressure >= 0.85
      ? colorToken('critical')
      : pressure >= 0.65
        ? colorToken('warning')
        : colorToken('textPrimary');
  const strokeColor = resolveColorToCss(gaugeColorToken, theme, false);

  const percentageLabel =
    usage === null ? '' : usage > 0 && usage < 0.01 ? '<1%' : `${Math.round(usage * 100)}%`;

  return (
    <Box
      ariaLabel={`CPU ${cpuRatio === null ? 'not reported' : `${Math.round(cpuRatio * 100)}%`} · Memory ${formatBytes(memoryBytes)}`}
      style={{
        layout: {
          position: 'relative',
          width: px(size),
          height: px(size),
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
        opacity: muted ? 0.36 : 1,
      }}
    >
      <VectorGraphic
        viewWidth={32}
        viewHeight={32}
        width={size}
        height={size}
        ariaHidden
        stroke={strokeColor}
        strokeWidth={DUO_USAGE_GEOMETRY.stroke}
        paths={[
          {
            d: DUO_USAGE_GEOMETRY.arc,
            fill: 'none',
            stroke: strokeColor,
            strokeWidth: DUO_USAGE_GEOMETRY.stroke,
            strokeLinecap: 'round',
            opacity: 0.28,
          },
          ...(cpuRatio !== null && cpuRatio > 0
            ? [
                {
                  d: duoUsageArc(cpuRatio),
                  fill: 'none',
                  stroke: strokeColor,
                  strokeWidth: DUO_USAGE_GEOMETRY.stroke,
                  strokeLinecap: 'round' as const,
                  opacity: 1,
                },
              ]
            : []),
          ...(muted
            ? [
                {
                  d: 'M10 15h3l2-5 3 10 2-5h2',
                  fill: 'none',
                  stroke: strokeColor,
                  strokeWidth: 1.3,
                  strokeLinecap: 'round' as const,
                  strokeLinejoin: 'round' as const,
                  opacity: 0.9,
                },
              ]
            : []),
        ]}
        circles={DUO_USAGE_GEOMETRY.dots.map(({ x, y }, index) => ({
          cx: x,
          cy: y,
          r: DUO_USAGE_GEOMETRY.dotRadius,
          fill: strokeColor,
          opacity:
            DUO_USAGE_GEOMETRY.inactiveOpacity +
            (1 - DUO_USAGE_GEOMETRY.inactiveOpacity) *
              Math.min(1, Math.max(0, (memRatio ?? 0) * 4 - index)),
        }))}
      />
      {!muted && (
        <Box
          ariaHidden
          style={{
            layout: {
              position: 'absolute',
              inset: { top: px(0), right: px(0), bottom: px(3), left: px(0) },
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
            pointerEvents: 'none',
          }}
        >
          <Text
            size={size >= 44 ? 9.5 : 8.5}
            weight={600}
            style={{
              typography: {
                color: gaugeColorToken,
                tabularNums: true,
                letterSpacing: -0.02,
              },
            }}
          >
            {percentageLabel}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/** Electron-matched pair: DuoBar gauge beside aligned CPU / Memory tabular stats. */
export function ServerServiceUsage({
  cpuPercent,
  memoryBytes,
  totalMemoryBytes,
  inactive = false,
  gaugeSize = 44,
}: {
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly totalMemoryBytes: number | null;
  readonly inactive?: boolean;
  readonly gaugeSize?: number;
}) {
  const cpuText =
    cpuPercent === null
      ? '—'
      : cpuPercent < 0.1 && cpuPercent > 0
        ? '<0.1%'
        : `${cpuPercent.toFixed(1)}%`;
  return (
    <Row align="center" gapPx={12} style={{ layout: { flexShrink: 0 } }}>
      <ServerUsageGauge
        cpuPercent={cpuPercent}
        memoryBytes={memoryBytes}
        totalMemoryBytes={totalMemoryBytes}
        inactive={inactive}
        size={gaugeSize}
      />
      <Stack gapPx={4} style={{ layout: { width: px(138) } }}>
        <Row align="center" justify="between" gapPx={8}>
          <Text size={10} tone="muted">
            CPU
          </Text>
          <Text size={11.5} weight={500} style={{ typography: { tabularNums: true } }}>
            {cpuText}
          </Text>
        </Row>
        <Row align="center" justify="between" gapPx={8}>
          <Text size={10} tone="muted">
            Memory
          </Text>
          <Text size={11.5} weight={500} style={{ typography: { tabularNums: true } }}>
            {formatBytes(memoryBytes)}
          </Text>
        </Row>
      </Stack>
    </Row>
  );
}

/** Proportional multi-segment disk allocation bar with legend matching Electron's DiskSpaceBar. */
export function ServerDiskSpaceBar({
  disk,
  onSelectVolume,
}: {
  readonly disk: ServerDiskRecord;
  readonly onSelectVolume?: (id: string) => void;
}) {
  const { theme } = useHausUi();
  const isDark = theme.mode === 'dark';
  const total = disk.totalBytes ?? 0;
  const used = Math.max(0, disk.usedBytes ?? 0);
  const avail = Math.max(0, disk.availableBytes ?? Math.max(0, total - used));
  const reserved = Math.max(0, total - used - avail);

  const usedPct = total > 0 ? Math.round((used / total) * 100) : 0;
  const reservedPct = total > 0 ? Math.round((reserved / total) * 100) : 0;
  const availPct = Math.max(0, 100 - usedPct - reservedPct);

  const usedColor = isDark ? rgba(255, 255, 255, 0.86) : rgba(24, 24, 27, 0.84);
  const reservedColor = isDark ? rgba(255, 255, 255, 0.34) : rgba(24, 24, 27, 0.28);
  const freeColor = isDark ? rgba(255, 255, 255, 0.1) : rgba(24, 24, 27, 0.08);

  const segments = [
    { id: 'used', label: 'Used', bytes: used, pctVal: usedPct, color: usedColor },
    ...(reserved > total * 0.01
      ? [
          {
            id: 'reserved',
            label: 'System / reserved',
            bytes: reserved,
            pctVal: reservedPct,
            color: reservedColor,
          },
        ]
      : []),
    { id: 'free', label: 'Available', bytes: avail, pctVal: availPct, color: freeColor },
  ];

  return (
    <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
        <Text size={11.5} weight={600}>
          Space usage
        </Text>
        <Text size={11.5} tone="muted" style={{ typography: { tabularNums: true } }}>
          {`${usedPct}% of ${formatBytes(disk.totalBytes)}`}
        </Text>
      </Row>
      <Row
        gapPx={2}
        style={{
          layout: { width: pct(100), height: px(10), overflow: 'hidden' },
          material: new SolidMaterial(colorToken('soft')),
          corners: corners(999, 'round'),
        }}
      >
        {segments.map((segment) =>
          segment.pctVal > 0 ? (
            onSelectVolume ? (
              <Pressable
                key={segment.id}
                ariaLabel={`${segment.label}: ${formatBytes(segment.bytes)}`}
                onActivate={() => onSelectVolume(disk.id)}
                style={{
                  layout: { width: pct(segment.pctVal), height: pct(100) },
                  material: new SolidMaterial(segment.color),
                }}
              />
            ) : (
              <Box
                key={segment.id}
                style={{
                  layout: { width: pct(segment.pctVal), height: pct(100) },
                  material: new SolidMaterial(segment.color),
                }}
              />
            )
          ) : null,
        )}
      </Row>
      <Row gapPx={16} wrap style={{ layout: { width: pct(100) } }}>
        {segments.map((segment) => (
          <Row key={segment.id} align="center" gapPx={6}>
            <Box
              ariaHidden
              style={{
                layout: { width: px(8), height: px(8) },
                material: new SolidMaterial(segment.color),
                corners: corners(999, 'round'),
              }}
            />
            <Text size={11} tone="muted">
              {segment.label}
            </Text>
            <Text size={11} weight={600} style={{ typography: { tabularNums: true } }}>
              {formatBytes(segment.bytes)}
            </Text>
          </Row>
        ))}
      </Row>
    </Stack>
  );
}
