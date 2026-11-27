/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState, type ReactNode } from 'react';
import { colorToken, corners, insets, pct, px, rgba, type ColorValue } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  Pressable,
  Row,
  ScrollView,
  Stack,
  Text,
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

const DARK_ANSI_16: readonly string[] = [
  '#242424',
  '#ff4245',
  '#34c759',
  '#ffd600',
  '#369aff',
  '#ca71f0',
  '#5ac8fa',
  '#e5e5e5',
  '#8a8f98',
  '#ff696b',
  '#6cdb89',
  '#ffe572',
  '#69b6ff',
  '#e49dff',
  '#92dcff',
  '#ffffff',
];

const LIGHT_ANSI_16: readonly string[] = [
  '#171717',
  '#d92d20',
  '#16a34a',
  '#b45309',
  '#2563eb',
  '#9333ea',
  '#0284c7',
  '#4b5563',
  '#6b7280',
  '#ef4444',
  '#22c55e',
  '#d97706',
  '#3b82f6',
  '#a855f7',
  '#06b6d4',
  '#111827',
];

const CUBE_STEPS = [0, 95, 135, 175, 215, 255] as const;

function ansiIndexColor(index: number, dark: boolean): string | undefined {
  const table = dark ? DARK_ANSI_16 : LIGHT_ANSI_16;
  if (index >= 0 && index < 16) return table[index];
  if (index >= 16 && index < 232) {
    const c = index - 16;
    const r = CUBE_STEPS[Math.floor(c / 36)] ?? 0;
    const g = CUBE_STEPS[Math.floor((c % 36) / 6)] ?? 0;
    const b = CUBE_STEPS[c % 6] ?? 0;
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (index >= 232 && index < 256) {
    const v = 8 + (index - 232) * 10;
    return `rgb(${v}, ${v}, ${v})`;
  }
  return undefined;
}

export interface ColoredLogSegment {
  readonly text: string;
  readonly color?: string;
  readonly bold?: boolean;
  readonly dim?: boolean;
}

/**
 * Parses ANSI SGR escape sequences (`\x1b[...m`) AND enriches plain-text structured logs
 * (`[OK]`, `[INFO]`, `[WARN]`, `[ERROR]`, timestamps) into portable colored segments.
 */
export function parseColoredLogLine(line: string, dark: boolean): readonly ColoredLogSegment[] {
  if (!line) return [{ text: ' ' }];
  // eslint-disable-next-line no-control-regex
  if (line.includes('\x1b[')) {
    const segments: ColoredLogSegment[] = [];
    let fg: string | undefined;
    let bold = false;
    let dim = false;
    // eslint-disable-next-line no-control-regex
    const re = /\x1b\[([0-9;]*)m/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      if (match.index > lastIdx) {
        segments.push({ text: line.slice(lastIdx, match.index), color: fg, bold, dim });
      }
      const codes = (match[1] ?? '').split(';').map((part) => (part === '' ? 0 : Number(part)));
      for (let i = 0; i < codes.length; i += 1) {
        const code = codes[i] ?? 0;
        if (code === 0) {
          fg = undefined;
          bold = false;
          dim = false;
        } else if (code === 1) bold = true;
        else if (code === 2) dim = true;
        else if (code === 22) {
          bold = false;
          dim = false;
        } else if (code === 39) fg = undefined;
        else if (code >= 30 && code <= 37) fg = ansiIndexColor(code - 30 + (bold ? 8 : 0), dark);
        else if (code >= 90 && code <= 97) fg = ansiIndexColor(code - 90 + 8, dark);
        else if (code === 38) {
          const mode = codes[i + 1];
          if (mode === 5 && typeof codes[i + 2] === 'number') {
            fg = ansiIndexColor(codes[i + 2]!, dark);
            i += 2;
          } else if (
            mode === 2 &&
            typeof codes[i + 2] === 'number' &&
            typeof codes[i + 3] === 'number' &&
            typeof codes[i + 4] === 'number'
          ) {
            fg = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
            i += 4;
          }
        }
      }
      lastIdx = re.lastIndex;
    }
    if (lastIdx < line.length) {
      segments.push({ text: line.slice(lastIdx), color: fg, bold, dim });
    }
    return segments.length > 0 ? segments : [{ text: ' ' }];
  }

  const palette = dark ? DARK_ANSI_16 : LIGHT_ANSI_16;
  const tsMatch =
    /^(\[?\d{2,4}[-:]\d{2}[-:]\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?\]?\s*)(.*)$/.exec(line);
  const out: ColoredLogSegment[] = [];
  let rest = line;
  if (tsMatch) {
    out.push({ text: tsMatch[1]!, color: palette[8], dim: true });
    rest = tsMatch[2] ?? '';
  }
  const tagMatch =
    /^(\[(?:OK|DONE|READY|SUCCESS|INFO|PULL|BUILD|SYNC|CLUSTER|STEP|WARN|WARNING|ERR|ERROR|FAIL|FAILED)\]|\b(?:INFO|WARNING|WARN|ERROR|CRITICAL)\b:?)\s*(.*)$/i.exec(
      rest,
    );
  if (tagMatch) {
    const rawTag = tagMatch[1]!;
    const upper = rawTag.toUpperCase();
    let tagColor = palette[6];
    if (/ERR|FAIL|CRIT/.test(upper)) tagColor = palette[1];
    else if (/WARN/.test(upper)) tagColor = palette[3];
    else if (/OK|DONE|READY|SUCCESS/.test(upper)) tagColor = palette[2];
    else if (/PULL|BUILD|SYNC|CLUSTER/.test(upper)) tagColor = palette[4];
    out.push({ text: `${rawTag} `, color: tagColor, bold: true });
    rest = tagMatch[2] ?? '';
  }
  if (rest) {
    let lineColor: string | undefined;
    if (/\b(?:error|failed|exception|fatal)\b/i.test(rest)) lineColor = palette[9];
    else if (/\b(?:pull complete|download complete|installed|succeeded|committed)\b/i.test(rest))
      lineColor = palette[10];
    out.push({ text: rest, color: lineColor });
  }
  return out.length > 0 ? out : [{ text: line }];
}

function parseCssColor(css: string | undefined, fallback: ColorValue, alpha = 1): ColorValue {
  if (!css) return fallback;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (hex) {
    return rgba(
      Number.parseInt(hex[1]!, 16),
      Number.parseInt(hex[2]!, 16),
      Number.parseInt(hex[3]!, 16),
      alpha,
    );
  }
  const rgbMatch = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(css);
  if (rgbMatch) {
    return rgba(Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3]), alpha);
  }
  return fallback;
}

export function ColoredLogViewer({
  lines,
  text,
  maxHeight = 220,
  emptyLabel = 'Waiting for log output…',
  id,
}: {
  readonly lines?: readonly string[];
  readonly text?: string;
  readonly maxHeight?: number;
  readonly emptyLabel?: string;
  readonly id?: string;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const resolvedLines =
    lines && lines.length > 0 ? lines : text ? text.replace(/\r\n/g, '\n').split('\n') : [];
  const bg = dark ? rgba(10, 12, 16, 0.88) : rgba(246, 248, 251, 0.96);
  const border = dark ? rgba(255, 255, 255, 0.1) : rgba(15, 23, 42, 0.12);
  const defaultFg = dark ? rgba(229, 231, 235, 1) : rgba(31, 41, 55, 1);

  return (
    <ScrollView
      id={id}
      orientation="vertical"
      style={{
        layout: { width: pct(100), maxHeight: px(maxHeight), padding: insets(10, 12) },
        material: new SolidMaterial(bg),
        border: { width: 1, color: border },
        corners: corners(12),
      }}
    >
      {resolvedLines.length === 0 ? (
        <Text size={11.5} mono tone="muted">
          {emptyLabel}
        </Text>
      ) : (
        <Stack gapPx={3} style={{ layout: { width: pct(100) } }}>
          {resolvedLines.map((line, lineIdx) => {
            const segments = parseColoredLogLine(line, dark);
            return (
              <Row
                key={`${lineIdx}-${line.slice(0, 24)}`}
                align="start"
                gapPx={0}
                wrap
                style={{ layout: { width: pct(100) } }}
              >
                {segments.map((seg, segIdx) => (
                  <Text
                    key={segIdx}
                    size={11.5}
                    mono
                    weight={seg.bold ? 600 : 400}
                    style={{
                      typography: {
                        color: parseCssColor(seg.color, defaultFg, seg.dim ? 0.72 : 1),
                        lineHeight: 1.45,
                      },
                    }}
                  >
                    {seg.text}
                  </Text>
                ))}
              </Row>
            );
          })}
        </Stack>
      )}
    </ScrollView>
  );
}

export function formatByteProgress(current?: number, total?: number): string | undefined {
  if (typeof current !== 'number' || !Number.isFinite(current) || current < 0) return undefined;
  const fmt = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${Math.round(bytes)} B`;
  };
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    return `${fmt(current)} / ${fmt(total)}`;
  }
  return fmt(current);
}

export function formatInstallStageTitle(stage: string): string {
  const labels: Readonly<Record<string, string>> = {
    validating: 'Validating manifest & permissions…',
    'checking-local': 'Checking local container cache…',
    pulling: 'Downloading package & layers…',
    building: 'Building image & dependencies…',
    ready: 'Package verified…',
    creating: 'Creating isolated container…',
    starting: 'Starting service runtime…',
    complete: 'Installed and running',
    failed: 'Installation failed',
  };
  return labels[stage] ?? `${stage}…`;
}

export function computeInstallProgressPercent(
  stage: string,
  current?: number,
  total?: number,
  explicitPercent?: number,
): number {
  if (typeof explicitPercent === 'number' && Number.isFinite(explicitPercent)) {
    return Math.max(0, Math.min(100, Math.round(explicitPercent)));
  }
  const base: Readonly<Record<string, number>> = {
    validating: 8,
    'checking-local': 16,
    pulling: 26,
    building: 58,
    ready: 78,
    creating: 86,
    starting: 94,
    complete: 100,
    failed: 100,
  };
  const stageBase = base[stage] ?? 15;
  if (
    (stage === 'pulling' || stage === 'building') &&
    typeof current === 'number' &&
    typeof total === 'number' &&
    total > 0
  ) {
    const ratio = Math.max(0, Math.min(1, current / total));
    return Math.min(92, Math.round(stageBase + ratio * (stage === 'pulling' ? 48 : 20)));
  }
  return stageBase;
}

export function OperationProgressPanel({
  id = 'operation-progress',
  title,
  detail,
  percent,
  state = 'running',
  logs = [],
  defaultLogsOpen = false,
  liveLogsSlot,
  onDismiss,
}: {
  readonly id?: string;
  readonly title: string;
  readonly detail?: string;
  readonly percent: number;
  readonly state?: 'running' | 'complete' | 'failed';
  readonly logs?: readonly string[];
  readonly defaultLogsOpen?: boolean;
  readonly liveLogsSlot?: ReactNode;
  readonly onDismiss?: () => void;
}) {
  const [logsOpen, setLogsOpen] = useState(defaultLogsOpen || state === 'failed');

  useEffect(() => {
    if (state === 'failed') setLogsOpen(true);
  }, [state]);

  const clamped = Math.max(2, Math.min(100, Math.round(percent)));
  const barColor =
    state === 'failed'
      ? colorToken('critical')
      : state === 'complete'
        ? colorToken('success')
        : colorToken('accent');
  const iconName: UiIconName =
    state === 'failed' ? 'alert-circle' : state === 'complete' ? 'check-circle' : 'loader-circle';
  const hasLogs = logs.length > 0 || Boolean(liveLogsSlot);

  return (
    <Stack
      id={id}
      gapPx={10}
      style={{
        layout: { width: pct(100), padding: insets(12, 14) },
        material: new SolidMaterial(colorToken('surfaceSecondary')),
        border: {
          width: 1,
          color: state === 'failed' ? rgba(239, 68, 68, 0.4) : colorToken('border'),
        },
        corners: corners(14),
      }}
    >
      <Row align="center" justify="between" gapPx={10} wrap>
        <Row align="center" gapPx={8} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
          <UiIcon name={iconName} size={15} />
          <Stack gapPx={1} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={12.5} weight={600} tone={state === 'failed' ? 'critical' : 'primary'}>
              {title}
            </Text>
            {detail && (
              <Text size={11.5} tone="muted">
                {detail}
              </Text>
            )}
          </Stack>
        </Row>
        <Row align="center" gapPx={8}>
          <Text size={11.5} mono weight={600} tone="muted">
            {`${Math.round(percent)}%`}
          </Text>
          {hasLogs && (
            <Pressable
              id={`${id}-toggle-logs`}
              ariaPressed={logsOpen}
              onActivate={() => setLogsOpen((prev) => !prev)}
              style={{
                layout: {
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(5),
                  padding: insets(4, 9),
                },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(999),
              }}
            >
              <UiIcon name="terminal" size={12} />
              <Text size={11} weight={600}>
                {logsOpen ? 'Hide logs' : logs.length > 0 ? `Logs (${logs.length})` : 'Live logs'}
              </Text>
            </Pressable>
          )}
          {onDismiss && state !== 'running' && (
            <HausButton id={`${id}-dismiss`} variant="ghost" size="sm" onPress={onDismiss}>
              Close
            </HausButton>
          )}
        </Row>
      </Row>

      <Box
        role="progressbar"
        ariaLabel={title}
        style={{
          layout: { width: pct(100), height: px(6), overflow: 'hidden' },
          material: new SolidMaterial(colorToken('border')),
          corners: corners(999),
        }}
      >
        <Box
          style={{
            layout: { width: pct(clamped), height: pct(100) },
            material: new SolidMaterial(barColor),
            corners: corners(999),
            transitionMs: 220,
            pointerEvents: 'none',
          }}
        />
      </Box>

      {logsOpen && (
        <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
          {logs.length > 0 && <ColoredLogViewer id={`${id}-logs`} lines={logs} maxHeight={200} />}
          {liveLogsSlot}
        </Stack>
      )}
    </Stack>
  );
}
