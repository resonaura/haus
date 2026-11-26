/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  corners,
  insets,
  mixColor,
  pct,
  px,
  rgba,
  transparentColor,
  type ColorValue,
} from '../../ir/geometry.js';
import { GradientMaterial, SolidMaterial } from '../../ir/materials.js';
import { Box } from '../../primitives/elements.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

const customIcons = new Map<string, UiIconName>([
  ['mdi:weather-night', 'moon-star'],
  ['mdi:white-balance-sunny', 'sun'],
  ['mdi:sofa', 'armchair'],
  ['mdi:movie-open', 'clapperboard'],
  ['mdi:book-open-variant', 'book-open'],
  ['mdi:home', 'house'],
  ['mdi:sparkles', 'sparkles'],
]);

const sceneIcons: readonly (readonly [RegExp, UiIconName])[] = [
  [/night|sleep/i, 'moon-star'],
  [/movie|cinema|netflix/i, 'clapperboard'],
  [/away|leave/i, 'door-open'],
  [/relax|chill/i, 'armchair'],
  [/read/i, 'book-open'],
  [/concentrate|focus/i, 'focus'],
  [/energ/i, 'sunrise'],
  [/dim|sunset/i, 'sunset'],
  [/bright|day|morning/i, 'sun'],
];

export const SCENE_ART_TOP_CORNERS = { ...corners(25), bottomLeft: 0, bottomRight: 0 };

export interface ParsedSceneSwatch {
  readonly css: string;
  readonly color: ColorValue;
}

export function SceneIcon({ name, icon, color }: { name: string; icon?: string; color?: string }) {
  const glyph = customIcons.get(icon ?? '') ?? sceneIcons.find(([rule]) => rule.test(name))?.[1];
  return <UiIcon name={glyph ?? 'sparkles'} size={19} color={color} strokeWidth={1.75} />;
}

function dimForDarkScene(color: ColorValue): ColorValue {
  if (color.kind !== 'rgba') return color;
  const luma = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
  const sat = 0.72;
  const bright = 0.36;
  const r = Math.round(Math.min(255, Math.max(0, (luma + (color.r - luma) * sat) * bright)));
  const g = Math.round(Math.min(255, Math.max(0, (luma + (color.g - luma) * sat) * bright)));
  const b = Math.round(Math.min(255, Math.max(0, (luma + (color.b - luma) * sat) * bright)));
  return rgba(r, g, b, color.a);
}

/**
 * Diffused GPU-blurred light-field preview shared identically across GPUIX and Electron.
 * Renders a rich tinted base topped by real Gaussian/Kawase blurred ambient orbs, clipped cleanly
 * to the card's 25px continuous top superellipse contour.
 */
export function SceneArtwork({
  swatches,
  darkScene,
  isDarkTheme,
}: {
  readonly swatches: readonly ParsedSceneSwatch[];
  readonly darkScene: boolean;
  readonly isDarkTheme: boolean;
}) {
  const palette = swatches.map(({ color }) => (darkScene ? dimForDarkScene(color) : color));
  const neutralBase = darkScene
    ? isDarkTheme
      ? rgba(13, 14, 17, 1)
      : rgba(28, 30, 36, 1)
    : isDarkTheme
      ? rgba(28, 29, 34, 1)
      : rgba(229, 231, 236, 1);

  if (!palette.length) {
    return (
      <Box
        ariaHidden
        className="scene-artwork-stage"
        style={{
          layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
          corners: SCENE_ART_TOP_CORNERS,
          pointerEvents: 'none',
          material: new GradientMaterial(
            darkScene
              ? [
                  { offset: 0, color: mixColor(neutralBase, rgba(255, 255, 255, 1), 0.05) },
                  { offset: 1, color: mixColor(neutralBase, rgba(0, 0, 0, 1), 0.24) },
                ]
              : [
                  { offset: 0, color: mixColor(neutralBase, rgba(255, 255, 255, 1), 0.08) },
                  { offset: 1, color: mixColor(neutralBase, rgba(0, 0, 0, 1), 0.1) },
                ],
            160,
            'linear',
          ),
        }}
      />
    );
  }

  const c0 = palette[0]!;
  const singleColor = palette.length === 1;
  const orb0 = singleColor ? mixColor(c0, rgba(24, 14, 8, 1), 0.2) : c0;
  const orb1 = singleColor ? mixColor(c0, rgba(255, 250, 240, 1), 0.14) : palette[1]!;
  const orb2 = palette[2] ?? c0;
  const orb3 = palette[3];
  const baseMix = darkScene ? 0.24 : isDarkTheme ? 0.44 : 0.48;
  const baseStart = mixColor(neutralBase, orb0, baseMix);
  const baseEnd = mixColor(neutralBase, orb1, baseMix * 0.9);

  return (
    <Box
      ariaHidden
      className="scene-artwork-stage"
      style={{
        layout: {
          position: 'absolute',
          inset: insets(0),
          width: pct(100),
          height: pct(100),
          overflow: 'hidden',
        },
        corners: SCENE_ART_TOP_CORNERS,
        pointerEvents: 'none',
        material: new GradientMaterial(
          [
            { offset: 0, color: baseStart },
            { offset: 1, color: baseEnd },
          ],
          145,
          'linear',
        ),
      }}
    >
      <Box
        ariaHidden
        className="scene-artwork-blur"
        style={{
          layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
          pointerEvents: 'none',
          material: new SolidMaterial(transparentColor, { radius: 26, quality: 'medium' }),
        }}
      >
        <Box
          ariaHidden
          style={{
            layout: {
              position: 'absolute',
              inset: { left: px(-24), bottom: px(-30) },
              width: pct(68),
              height: px(96),
            },
            corners: corners(999, 'round'),
            material: new SolidMaterial(orb0),
          }}
        />
        <Box
          ariaHidden
          style={{
            layout: {
              position: 'absolute',
              inset: { right: px(-20), top: px(-34) },
              width: pct(66),
              height: px(96),
            },
            corners: corners(999, 'round'),
            material: new SolidMaterial(orb1),
          }}
        />
        <Box
          ariaHidden
          style={{
            layout: {
              position: 'absolute',
              inset: { right: px(-22), bottom: px(-34) },
              width: pct(60),
              height: px(90),
            },
            corners: corners(999, 'round'),
            material: new SolidMaterial(orb2),
          }}
        />
        {orb3 && (
          <Box
            ariaHidden
            style={{
              layout: {
                position: 'absolute',
                inset: { left: px(48), top: px(-22) },
                width: pct(46),
                height: px(78),
              },
              corners: corners(999, 'round'),
              opacity: 0.78,
              material: new SolidMaterial(orb3),
            }}
          />
        )}
      </Box>
    </Box>
  );
}
