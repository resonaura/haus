/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useId, useState } from 'react';
import { colorToken, insets, px } from '../../ir/geometry.js';
import { useHausUi } from '../../primitives/context.js';
import { Box } from '../../primitives/elements.js';
import { VectorGraphic } from '../../primitives/media.js';
import { resolveColorToCss } from '../../renderers/contract.js';
import { getDeviceTileTokens } from './tile-theme.js';

const BATTERY_BODY_PATH =
  'M17.865 0c1.1017 0 1.6525 0 2.1071.1091a3.95 3.95 0 0 1 2.9188 2.9188C23 3.4825 23 4.0333 23 5.135v1.73c0 1.1017 0 1.6525-.1091 2.1071a3.95 3.95 0 0 1-2.9188 2.9188C19.5175 12 18.9667 12 17.865 12H5.135c-1.1017 0-1.6525 0-2.1071-.1091A3.95 3.95 0 0 1 .1091 8.9721C0 8.5175 0 7.9667 0 6.865v-1.73c0-1.1017 0-1.6525.1091-2.1071A3.95 3.95 0 0 1 3.0279.1091C3.4825 0 4.0333 0 5.135 0Z';
const BATTERY_TERMINAL_PATH = 'M24 5.5a2 2 0 0 1 0 4Z';
const BATTERY_BOLT_PATH =
  'M13.23.87c.35-.43.99-.16.81.36l-1.65 4.72h3.45c.46 0 .67.53.37.88l-6.13 7.29c-.36.43-.99.16-.81-.36l1.66-4.71H7.47c-.47 0-.67-.53-.37-.88Z';

function pendingDelayMs(since?: number, delayMs = 280): number {
  if (!since) return delayMs;
  return Math.max(0, since + delayMs - Date.now());
}

/** Keeps quick commands quiet; measures from a shared command start timestamp across views. */
export function useDelayedPending(pending: boolean, since?: number, delayMs = 280): boolean {
  const key = since ?? 'local';
  const [visibleFor, setVisibleFor] = useState<number | 'local'>();
  useEffect(() => {
    setVisibleFor(undefined);
    if (!pending) return;
    const timer = setTimeout(() => setVisibleFor(key), pendingDelayMs(since, delayMs));
    return () => clearTimeout(timer);
  }, [pending, since, delayMs, key]);
  return pending && visibleFor === key;
}

export function BatteryLevelIcon({
  level,
  charging = false,
  powerConnected = false,
  size = 15,
}: {
  readonly level?: number;
  readonly charging?: boolean;
  readonly powerConnected?: boolean;
  readonly size?: number;
}) {
  const { theme } = useHausUi();
  const id = useId().replace(/:/g, '');
  const tokens = getDeviceTileTokens(theme.mode);
  const baseColor = resolveColorToCss(tokens.deviceIconBase, theme, false);
  const criticalColor = resolveColorToCss(colorToken('critical'), theme, false);
  const isCharging = charging || powerConnected;
  const isLow = typeof level === 'number' && level <= 20;
  const fillWidth =
    typeof level === 'number' && Number.isFinite(level)
      ? Number(((23 * Math.max(0, Math.min(100, level))) / 100).toFixed(2))
      : 0;
  const widthPx = Number(((size * 26) / 15).toFixed(2));
  const maskDef = isCharging
    ? `<mask id="${id}-charge" x="0" y="0" width="26" height="15" maskUnits="userSpaceOnUse"><rect width="26" height="15" fill="#fff"/><path d="${BATTERY_BOLT_PATH}" fill="#000" stroke="#000" stroke-width="2.3" stroke-linejoin="round" stroke-linecap="round"/></mask>`
    : '';
  const groupOpen = isCharging ? `<g mask="url(#${id}-charge)">` : '<g>';
  const shellSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 15" width="${widthPx}" height="${size}">${maskDef}${groupOpen}<g transform="translate(0 1.5)"><path d="${BATTERY_BODY_PATH}" fill="currentColor" fill-opacity="0.48"/></g><path d="${BATTERY_TERMINAL_PATH}" fill="currentColor" fill-opacity="0.48"/></g>${isCharging ? `<path d="${BATTERY_BOLT_PATH}" fill="currentColor"/>` : ''}</svg>`;
  const fillSvg =
    fillWidth > 0
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 15" width="${widthPx}" height="${size}"><defs><clipPath id="${id}-level"><path d="${BATTERY_BODY_PATH}"/></clipPath>${maskDef}</defs>${groupOpen}<g transform="translate(0 1.5)"><rect x="0" y="0" width="${fillWidth}" height="12" fill="currentColor" clip-path="url(#${id}-level)"/></g></g></svg>`
      : '';

  return (
    <Box
      ariaHidden
      className={`battery-level-icon ${isCharging ? 'is-charging' : ''} ${isLow ? 'is-low' : ''}`.trim()}
      style={{
        layout: {
          position: 'relative',
          width: px(widthPx),
          height: px(size),
        },
        pointerEvents: 'none',
      }}
    >
      <Box
        style={{
          layout: { position: 'absolute', inset: insets(0) },
          pointerEvents: 'none',
        }}
      >
        <VectorGraphic
          viewWidth={26}
          viewHeight={15}
          width={widthPx}
          height={size}
          stroke={baseColor}
          rawSvgMarkup={shellSvg}
          ariaHidden
        />
      </Box>
      {fillWidth > 0 && (
        <Box
          style={{
            layout: { position: 'absolute', inset: insets(0) },
            pointerEvents: 'none',
          }}
        >
          <VectorGraphic
            viewWidth={26}
            viewHeight={15}
            width={widthPx}
            height={size}
            stroke={isLow ? criticalColor : baseColor}
            rawSvgMarkup={fillSvg}
            ariaHidden
          />
        </Box>
      )}
    </Box>
  );
}
