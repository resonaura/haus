/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import {
  GLASS_RIM_PRESETS,
  getGlassRimPreset,
  renderGlassRimNineSlice,
  type GlassRimEffectMotion,
  type GlassRimPresetName,
  type GlassRimRaster,
} from '../ir/glass-rim.js';
import { resolveColorToCss, type RenderContext } from './contract.js';
import type { HostGlassRimProps } from './host.js';

interface EncodedRimEntry {
  readonly name: GlassRimPresetName;
  readonly dataUrl: string;
  readonly sliceXPx: number;
  readonly sliceYPx: number;
  readonly sliceXPts: number;
  readonly sliceYPts: number;
}

const encodedCache = new Map<string, readonly EncodedRimEntry[]>();
let appliedKey = '';

function supportsSuperellipseCornerShape(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  return CSS.supports('corner-shape', 'superellipse(1.4)');
}

function rasterToPngDataUrl(raster: GlassRimRaster): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imageData = ctx.createImageData(raster.width, raster.height);
  imageData.data.set(raster.pixels);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function buildRimEntries(
  isDark: boolean,
  scale: number,
  continuousSuperellipse: boolean,
): readonly EncodedRimEntry[] | null {
  const key = `${isDark ? 'dark' : 'light'}:${scale}:${continuousSuperellipse ? 'se' : 'rd'}`;
  const cached = encodedCache.get(key);
  if (cached) return cached;

  const entries: EncodedRimEntry[] = [];
  for (const preset of GLASS_RIM_PRESETS) {
    const raster = renderGlassRimNineSlice({
      radius: preset.radius,
      scale,
      isDark,
      circular: preset.circular,
      continuousSuperellipse,
      maxSliceYPts: preset.maxSliceYPts,
      refPlateDark: preset.refPlateDark,
      refPlateLight: preset.refPlateLight,
      strength: preset.strength,
    });
    const dataUrl = rasterToPngDataUrl(raster);
    if (!dataUrl) return null;
    entries.push({
      name: preset.name,
      dataUrl,
      sliceXPx: raster.sliceXPx,
      sliceYPx: raster.sliceYPx,
      sliceXPts: raster.sliceXPts,
      sliceYPts: raster.sliceYPts,
    });
  }
  encodedCache.set(key, entries);
  return entries;
}

/**
 * Installs theme- and DPR-matched analytical Liquid Glass rim textures as CSS
 * custom properties (`--glass-rim-<preset>`, `... -slice`, `... -width`) on `:root`.
 */
export function syncDocumentGlassRimLighting(isDark: boolean): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const scale = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 2)));
  const continuousSuperellipse = supportsSuperellipseCornerShape();
  const key = `${isDark ? 'dark' : 'light'}:${scale}:${continuousSuperellipse ? 'se' : 'rd'}`;
  if (key === appliedKey) return;

  const entries = buildRimEntries(isDark, scale, continuousSuperellipse);
  if (!entries) return;

  const rootStyle = document.documentElement.style;
  for (const entry of entries) {
    rootStyle.setProperty(`--glass-rim-${entry.name}`, `url("${entry.dataUrl}")`);
    rootStyle.setProperty(`--glass-rim-${entry.name}-slice`, `${entry.sliceYPx} ${entry.sliceXPx}`);
    rootStyle.setProperty(
      `--glass-rim-${entry.name}-width`,
      `${entry.sliceYPts}px ${entry.sliceXPts}px`,
    );
  }
  appliedKey = key;
}

function buildAdaptiveGradient(
  c1: string,
  c2: string | undefined,
  c3: string | undefined,
  variant: 'card' | 'panel',
): string {
  const panel = variant === 'panel';
  if (c2 || c3) {
    const k1 = c1;
    const k2 = c2 ?? k1;
    const k3 = c3 ?? k2;
    const r1 = panel
      ? `radial-gradient(ellipse at 24% 6%, color-mix(in srgb, ${k1} 78%, #ffffff), transparent 58%)`
      : `radial-gradient(ellipse at 14% 12%, color-mix(in srgb, ${k1} 82%, #ffffff), transparent 60%)`;
    const r2 = panel
      ? `radial-gradient(ellipse at 78% 14%, color-mix(in srgb, ${k2} 74%, #ffffff), transparent 60%)`
      : `radial-gradient(ellipse at 86% 24%, color-mix(in srgb, ${k2} 76%, #ffffff), transparent 62%)`;
    const r3 = panel
      ? `radial-gradient(ellipse at 50% 96%, color-mix(in srgb, ${k3} 72%, #ffffff), transparent 66%)`
      : `radial-gradient(ellipse at 52% 94%, color-mix(in srgb, ${k3} 78%, #ffffff), transparent 66%)`;
    const lin = panel
      ? `linear-gradient(160deg, color-mix(in srgb, ${k1} 66%, #ffffff) 0%, color-mix(in srgb, ${k2} 56%, #ffffff) 50%, color-mix(in srgb, ${k3} 64%, #ffffff) 100%)`
      : `linear-gradient(145deg, color-mix(in srgb, ${k1} 70%, #ffffff) 0%, color-mix(in srgb, ${k2} 62%, #ffffff) 50%, color-mix(in srgb, ${k3} 68%, #ffffff) 100%)`;
    return `${r1}, ${r2}, ${r3}, ${lin}`;
  }

  const rad = panel
    ? `radial-gradient(ellipse at 50% 0%, color-mix(in srgb, ${c1} 72%, #ffffff) 0%, color-mix(in srgb, ${c1} 44%, #ffffff) 48%, transparent 78%)`
    : `radial-gradient(ellipse at 12% 10%, color-mix(in srgb, ${c1} 76%, #ffffff) 0%, color-mix(in srgb, ${c1} 52%, #ffffff) 46%, transparent 78%)`;
  const lin = panel
    ? `linear-gradient(165deg, color-mix(in srgb, ${c1} 62%, #ffffff) 0%, color-mix(in srgb, ${c1} 36%, #ffffff) 52%, color-mix(in srgb, ${c1} 52%, #ffffff) 100%)`
    : `linear-gradient(155deg, color-mix(in srgb, ${c1} 66%, #ffffff) 0%, color-mix(in srgb, ${c1} 40%, #ffffff) 52%, color-mix(in srgb, ${c1} 56%, #ffffff) 100%)`;
  return `${rad}, ${lin}`;
}

function effectWaapiSpec(
  motion: GlassRimEffectMotion | undefined,
): { readonly keyframes: Keyframe[]; readonly options: KeyframeAnimationOptions } | null {
  switch (motion) {
    case 'flicker':
      return {
        keyframes: [
          { opacity: 0.72, filter: 'hue-rotate(-4deg) saturate(1) brightness(0.97)', offset: 0 },
          { opacity: 0.9, filter: 'hue-rotate(6deg) saturate(1.1) brightness(1.07)', offset: 0.34 },
          { opacity: 0.78, filter: 'hue-rotate(-2deg) saturate(1.02) brightness(1)', offset: 0.62 },
          {
            opacity: 0.92,
            filter: 'hue-rotate(8deg) saturate(1.12) brightness(1.09)',
            offset: 0.82,
          },
          { opacity: 0.72, filter: 'hue-rotate(-4deg) saturate(1) brightness(0.97)', offset: 1 },
        ],
        options: { duration: 8400, easing: 'ease-in-out', iterations: Infinity },
      };
    case 'pulse':
      return {
        keyframes: [
          { opacity: 0.62, filter: 'brightness(0.95)', offset: 0 },
          { opacity: 0.9, filter: 'brightness(1.08)', offset: 0.5 },
          { opacity: 0.62, filter: 'brightness(0.95)', offset: 1 },
        ],
        options: { duration: 7200, easing: 'ease-in-out', iterations: Infinity },
      };
    case 'rainbow':
      return {
        keyframes: [{ filter: 'hue-rotate(0deg)' }, { filter: 'hue-rotate(360deg)' }],
        options: { duration: 16000, easing: 'linear', iterations: Infinity },
      };
    case 'aurora':
      return {
        keyframes: [
          { opacity: 0.74, filter: 'hue-rotate(-12deg) saturate(1.04)', offset: 0 },
          {
            opacity: 0.9,
            filter: 'hue-rotate(14deg) saturate(1.14) brightness(1.06)',
            offset: 0.5,
          },
          { opacity: 0.8, filter: 'hue-rotate(22deg) saturate(1.08)', offset: 1 },
        ],
        options: {
          duration: 13000,
          easing: 'ease-in-out',
          iterations: Infinity,
          direction: 'alternate',
        },
      };
    case 'wave':
      return {
        keyframes: [
          { opacity: 0.7, filter: 'hue-rotate(-8deg) brightness(0.96)', offset: 0 },
          { opacity: 0.88, filter: 'hue-rotate(10deg) brightness(1.07)', offset: 0.5 },
          { opacity: 0.76, filter: 'hue-rotate(-4deg) brightness(1)', offset: 1 },
        ],
        options: {
          duration: 9500,
          easing: 'ease-in-out',
          iterations: Infinity,
          direction: 'alternate',
        },
      };
    case 'sparkle':
      return {
        keyframes: [
          { opacity: 0.76, filter: 'brightness(0.97)', offset: 0 },
          { opacity: 1, filter: 'brightness(1.1)', offset: 0.36 },
          { opacity: 0.84, filter: 'brightness(1.01)', offset: 0.66 },
          { opacity: 0.98, filter: 'brightness(1.08)', offset: 0.86 },
          { opacity: 0.76, filter: 'brightness(0.97)', offset: 1 },
        ],
        options: { duration: 6800, easing: 'ease-in-out', iterations: Infinity },
      };
    case 'beat':
      return {
        keyframes: [
          { opacity: 0.66, filter: 'brightness(0.96)', offset: 0 },
          { opacity: 0.92, filter: 'brightness(1.12) saturate(1.1)', offset: 0.25 },
          { opacity: 0.74, filter: 'brightness(0.99)', offset: 0.5 },
          { opacity: 0.9, filter: 'brightness(1.1) saturate(1.08)', offset: 0.75 },
          { opacity: 0.66, filter: 'brightness(0.96)', offset: 1 },
        ],
        options: { duration: 3800, easing: 'ease-in-out', iterations: Infinity },
      };
    default:
      return null;
  }
}

export function DomGlassRim({
  props,
  context,
}: {
  readonly props: HostGlassRimProps;
  readonly context: RenderContext;
}): React.ReactElement | null {
  const { theme, viewport } = context;
  const isDark = theme.mode === 'dark';
  const preset = getGlassRimPreset(props.preset ?? 'card');
  const spanRef = React.useRef<HTMLSpanElement | null>(null);
  const suppressed = viewport.reducedTransparency || viewport.highContrast;

  React.useEffect(() => {
    if (!suppressed) syncDocumentGlassRimLighting(isDark);
  }, [isDark, suppressed]);

  const hasEffect = Boolean(props.effectColors?.[0]);
  const motion = hasEffect ? props.effectMotion : undefined;
  React.useEffect(() => {
    const el = spanRef.current;
    if (suppressed || viewport.reducedMotion || !el || typeof el.animate !== 'function') {
      return undefined;
    }
    const spec = effectWaapiSpec(motion);
    if (!spec) return undefined;
    const animation = el.animate(spec.keyframes, spec.options);
    return () => animation.cancel();
  }, [motion, suppressed, viewport.reducedMotion]);

  if (suppressed) return null;

  const variant = props.variant ?? (preset.name === 'panel' ? 'panel' : 'card');
  const c1Raw = props.effectColors?.[0] ?? props.tintColor;
  const isAdaptive = c1Raw !== undefined;
  const opacity = props.opacity ?? (variant === 'panel' ? 0.74 : 0.56);

  const style: React.CSSProperties & Record<string, string | number | undefined> = {
    position: 'absolute',
    inset: 0,
    zIndex: props.zIndex ?? 3,
    pointerEvents: 'none',
    borderRadius: 'inherit',
    opacity,
    transition: viewport.reducedMotion ? 'none' : 'opacity 240ms ease, filter 280ms ease',
  };

  const sourceVar = `var(--glass-rim-${preset.name})`;
  const sliceVar = `var(--glass-rim-${preset.name}-slice)`;
  const widthVar = `var(--glass-rim-${preset.name}-width)`;

  if (!isAdaptive) {
    if (preset.circular) {
      style.background = 'var(--glass-rim-circle) center / 100% 100% no-repeat';
    } else {
      style.border = '0 solid transparent';
      style.borderImageSource = sourceVar;
      style.borderImageSlice = sliceVar;
      style.borderImageWidth = widthVar;
      style.borderImageRepeat = 'stretch';
    }
  } else {
    const c1 = resolveColorToCss(c1Raw, theme, true);
    const c2 = props.effectColors?.[1]
      ? resolveColorToCss(props.effectColors[1], theme, true)
      : undefined;
    const c3 = props.effectColors?.[2]
      ? resolveColorToCss(props.effectColors[2], theme, true)
      : undefined;
    style.background = buildAdaptiveGradient(c1, c2, c3, variant);
    style.WebkitMaskBoxImageSource = sourceVar;
    style.WebkitMaskBoxImageSlice = `${sliceVar} fill`;
    style.WebkitMaskBoxImageWidth = widthVar;
    style.WebkitMaskBoxImageRepeat = 'stretch';
    style.maskBorderSource = sourceVar;
    style.maskBorderSlice = `${sliceVar} fill`;
    style.maskBorderWidth = widthVar;
    style.maskBorderRepeat = 'stretch';
    if (isDark) style.mixBlendMode = 'screen';
  }

  return (
    <span
      ref={spanRef}
      aria-hidden="true"
      data-haus-glass-rim={preset.name}
      data-rim-mode={hasEffect ? 'effect' : isAdaptive ? 'tint' : 'neutral'}
      style={style}
    />
  );
}
