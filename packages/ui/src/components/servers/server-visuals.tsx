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
  computeDuoBarGaugeMetrics,
  computeServerDiskSpace,
  computeServiceUsageScore,
  formatBytes,
  formatServiceCpuPercent,
  type ServerDiskRecord,
  type ServerDiskSpaceSegment,
  type ServerResourceSample,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { useHausUi } from '../../primitives/context.js';
import { Box, Heading, Pressable, Row, Stack, Text } from '../../primitives/elements.js';
import { VectorGraphic } from '../../primitives/media.js';
import { resolveColorToCss } from '../../renderers/contract.js';

export { computeServiceUsageScore };

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

/**
 * Rolling 60-second sparkline rendered identically in DOM and GPUIX.
 * Scales slide distance and linear tween duration to the exact sample interval
 * so the curve glides continuously at `(200 / 60) px/s` without freezing between ticks.
 */
export const ServerSparkline = memo(function ServerSparkline({
  history,
  field,
}: {
  readonly history: readonly ServerResourceSample[];
  readonly field: 'cpu' | 'memory' | 'swap';
}) {
  const { theme } = useHausUi();
  const lastSample = history.at(-1);
  const prevSample = history.length >= 2 ? history[history.length - 2] : undefined;
  const lastTime = lastSample?.time;
  const step = 200 / 60;
  const rawElapsed =
    lastTime !== undefined && prevSample !== undefined ? lastTime - prevSample.time : 1000;
  const elapsedMs = Math.min(3000, Math.max(400, rawElapsed));
  const slideOffset = (elapsedMs / 1000) * step;

  const parts: string[] = [];
  let continuous = false;
  let previousSampleTime: number | undefined;

  for (const sample of history) {
    if (lastTime === undefined || sample.time < lastTime - 63_000) continue;
    const value = sample[field];
    if (value === null) {
      continuous = false;
      continue;
    }
    if (previousSampleTime !== undefined && sample.time - previousSampleTime > 10_000) {
      continuous = false;
    }
    const x = 200 + slideOffset - ((lastTime - sample.time) / 1000) * step;
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
          initial: { x: slideOffset },
          animate: { x: 0 },
          durationMs: elapsedMs,
          ease: 'linear',
        }}
        style={{ layout: { width: pct(100), height: pct(100) }, pointerEvents: 'none' }}
      >
        <VectorGraphic
          viewWidth={200}
          viewHeight={42}
          width="100%"
          height={32}
          fill="none"
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

/** DuoBar-inspired compact gauge: independent CPU arc, 4 memory dots, and $L_4$ norm readout. */
export function ServerUsageGauge({
  cpuPercent,
  memoryBytes,
  totalMemoryBytes,
  inactive = false,
  system = false,
  cpuIncomplete = false,
  memoryIncomplete = false,
  size = 44,
}: {
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly totalMemoryBytes: number | null;
  readonly inactive?: boolean;
  readonly system?: boolean;
  readonly cpuIncomplete?: boolean;
  readonly memoryIncomplete?: boolean;
  readonly size?: number;
}) {
  const { theme } = useHausUi();
  const { cpuRatio, memoryRatio, usage, pressure } = computeDuoBarGaugeMetrics({
    cpuPercent,
    memoryBytes,
    totalMemoryBytes,
    system,
  });
  const muted = inactive || usage === null;

  const gaugeColorToken = muted
    ? colorToken('textPrimary')
    : pressure >= 0.85
      ? colorToken('critical')
      : pressure >= 0.65
        ? colorToken('warning')
        : colorToken('textPrimary');
  const strokeColor = resolveColorToCss(gaugeColorToken, theme, false);

  const prefix = cpuIncomplete || memoryIncomplete ? '≥' : '';
  const percentageLabel = usage === null ? '—' : `${prefix}${Math.round(usage * 100)}%`;

  return (
    <Box
      ariaLabel={`CPU arc: ${cpuRatio === null ? 'not reported' : `${Math.round(cpuRatio * 100)}% of host capacity`} · Memory dots: ${memoryRatio === null ? 'not reported' : `${Math.round(memoryRatio * 100)}% · ${formatBytes(memoryBytes)}`}`}
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
        opacity: muted ? 0.35 : 1,
      }}
    >
      <VectorGraphic
        viewWidth={32}
        viewHeight={32}
        width={size}
        height={size}
        fill="none"
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
                  strokeWidth: 1.25,
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
              Math.min(1, Math.max(0, (memoryRatio ?? 0) * 4 - index)),
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
  system = false,
  cpuIncomplete = false,
  memoryIncomplete = false,
  gaugeSize = 44,
}: {
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly totalMemoryBytes: number | null;
  readonly inactive?: boolean;
  readonly system?: boolean;
  readonly cpuIncomplete?: boolean;
  readonly memoryIncomplete?: boolean;
  readonly gaugeSize?: number;
}) {
  return (
    <Row align="center" gapPx={12} style={{ layout: { flexShrink: 0 } }}>
      <ServerUsageGauge
        cpuPercent={cpuPercent}
        memoryBytes={memoryBytes}
        totalMemoryBytes={totalMemoryBytes}
        inactive={inactive}
        system={system}
        cpuIncomplete={cpuIncomplete}
        memoryIncomplete={memoryIncomplete}
        size={gaugeSize}
      />
      <Stack gapPx={4} style={{ layout: { width: px(146) } }}>
        <Row align="center" justify="between" gapPx={8}>
          <Text size={10} tone="muted">
            CPU
          </Text>
          <Text size={11.5} weight={500} style={{ typography: { tabularNums: true } }}>
            {`${cpuIncomplete ? '≥ ' : ''}${formatServiceCpuPercent(cpuPercent)}`}
          </Text>
        </Row>
        <Row align="center" justify="between" gapPx={8}>
          <Text size={10} tone="muted">
            Memory
          </Text>
          <Text size={11.5} weight={500} style={{ typography: { tabularNums: true } }}>
            {`${memoryIncomplete ? '≥ ' : ''}${formatBytes(memoryBytes)}`}
          </Text>
        </Row>
      </Stack>
    </Row>
  );
}

function segmentColor(tone: ServerDiskSpaceSegment['tone'], index: number, isDark: boolean) {
  if (tone === 'used') return isDark ? rgba(255, 255, 255, 0.86) : rgba(24, 24, 27, 0.84);
  if (tone === 'other') return isDark ? rgba(255, 255, 255, 0.36) : rgba(24, 24, 27, 0.3);
  if (tone === 'available') return isDark ? rgba(255, 255, 255, 0.11) : rgba(24, 24, 27, 0.08);
  if (tone === 'allocation') {
    const alpha = 0.28 + (index % 4) * 0.14;
    return isDark ? rgba(255, 255, 255, alpha) : rgba(24, 24, 27, alpha);
  }
  return isDark ? rgba(255, 255, 255, 0.2) : rgba(24, 24, 27, 0.16);
}

/**
 * Proportional multi-segment disk / partition / pool bar matching Electron's `DiskSpaceBar` 1:1.
 * Supports clickable partition/volume allocation segments (`targetId`) and space-usage legends.
 */
export function ServerDiskSpaceBar({
  disk,
  disks,
  onSelectVolume,
}: {
  readonly disk: ServerDiskRecord;
  readonly disks?: readonly ServerDiskRecord[];
  readonly onSelectVolume?: (id: string) => void;
}) {
  const { theme } = useHausUi();
  const isDark = theme.mode === 'dark';
  const space = computeServerDiskSpace(disk, disks ?? [disk]);

  return (
    <Stack gapPx={10} style={{ layout: { width: pct(100) } }} ariaLabel={space.title}>
      <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
        <Heading level={5} size={11.5} weight={600}>
          {space.title}
        </Heading>
        <Text size={11.5} tone="muted" style={{ typography: { tabularNums: true } }}>
          {formatBytes(space.totalBytes)}
        </Text>
      </Row>

      <Row
        gapPx={2}
        role="group"
        ariaLabel={space.title}
        style={{
          layout: { width: pct(100), height: px(12), overflow: 'hidden' },
          material: new SolidMaterial(colorToken('soft')),
          corners: corners(999, 'round'),
        }}
      >
        {space.proportional &&
          space.segments.map((segment, index) => {
            if (!segment.bytes || !space.totalBytes) return null;
            const pctWidth = Math.max(0.5, (segment.bytes / space.totalBytes) * 100);
            const color = segmentColor(segment.tone, index, isDark);
            const label = `${segment.label}: ${formatBytes(segment.bytes)}`;
            return segment.targetId && onSelectVolume ? (
              <Pressable
                key={segment.id}
                ariaLabel={`Show ${label}`}
                title={label}
                onActivate={() => onSelectVolume(segment.targetId!)}
                style={{
                  layout: { width: pct(pctWidth), height: pct(100) },
                  material: new SolidMaterial(color),
                  border: { width: 0, style: 'none', color: transparentColor },
                }}
              />
            ) : (
              <Box
                key={segment.id}
                ariaLabel={label}
                title={label}
                style={{
                  layout: { width: pct(pctWidth), height: pct(100) },
                  material: new SolidMaterial(color),
                }}
              />
            );
          })}
      </Row>

      <Row gapPx={14} wrap style={{ layout: { width: pct(100) } }}>
        {space.segments.map((segment, index) => {
          const color = segmentColor(segment.tone, index, isDark);
          const content = (
            <Row align="center" gapPx={6}>
              <Box
                ariaHidden
                style={{
                  layout: { width: px(8), height: px(8), flexShrink: 0 },
                  material: new SolidMaterial(color),
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
          );
          return segment.targetId && onSelectVolume ? (
            <Pressable
              key={segment.id}
              ariaLabel={`Show ${segment.label}`}
              onActivate={() => onSelectVolume(segment.targetId!)}
              style={{
                layout: { padding: insets(2, 4) },
                material: new SolidMaterial(transparentColor),
                border: { width: 0, style: 'none', color: transparentColor },
                corners: corners(8),
              }}
            >
              {content}
            </Pressable>
          ) : (
            <Box key={segment.id}>{content}</Box>
          );
        })}
      </Row>

      <Text size={11} tone="muted" style={{ typography: { lineHeight: 1.45 } }}>
        {space.note}
      </Text>
    </Stack>
  );
}
