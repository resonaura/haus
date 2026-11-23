/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useMemo, useState } from 'react';
import { Box, Image as HausImage, Pressable, Text } from '@haus/ui';
import {
  ICON_APPEARANCES,
  ICON_TINT_COLORS,
  ICON_VARIATIONS,
  premultipliedIconPixels,
  renderEnclosureTileToRgba,
  resolveIconTintColor,
  resolveIconVariation,
  type IconAppearance,
  type IconTintColor,
  type IconVariation,
} from '@haus/icons';
import './icon-picker.scss';

interface HubIconCacheStatus {
  readonly version: string;
  readonly engine: 'cpp' | 'ts';
  readonly inventory: number;
  readonly ready: number;
  readonly queued: number;
  readonly active: number;
}

/** Builds a clean colorful Home/Lamp sample icon RGBA bitmap for authentic live previews. */
function buildPreviewSampleRgba(size = 80): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const cx = size * 0.5;
  const cy = size * 0.5;
  for (let y = 0; y < size; y += 1) {
    const ty = y / Math.max(1, size - 1);
    for (let x = 0; x < size; x += 1) {
      const idx = (x + y * size) * 4;
      // Vibrant HA-style sky-to-cobalt gradient plate
      let r = Math.round(65 + (14 - 65) * ty);
      let g = Math.round(189 + (116 - 189) * ty);
      let b = Math.round(245 + (232 - 245) * ty);

      // Crisp white house silhouette inside center
      const nx = (x + 0.5 - cx) / (size * 0.34);
      const ny = (y + 0.5 - cy) / (size * 0.34);
      const inRoof = ny >= -0.95 && ny <= 0.05 && Math.abs(nx) <= (ny + 0.95) * 1.05;
      const inBody = ny >= 0.0 && ny <= 0.85 && Math.abs(nx) <= 0.68;
      const inDoor = ny >= 0.25 && ny <= 0.85 && Math.abs(nx) <= 0.2;
      if ((inRoof || inBody) && !inDoor) {
        r = 255;
        g = 255;
        b = 255;
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }
  return premultipliedIconPixels(rgba);
}

const PREVIEW_SAMPLE = buildPreviewSampleRgba(256);
const previewUrlCache = new Map<string, string>();

function renderPreviewDataUrl(
  appearance: IconAppearance,
  variation: 'light' | 'dark',
  tintHex: string,
): string {
  const key = `${appearance}:${variation}:${appearance === 'tinted' ? tintHex : '-'}`;
  const hit = previewUrlCache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return '';
  const rendered = renderEnclosureTileToRgba(PREVIEW_SAMPLE, 256, 256, {
    targetSize: 256,
    displaySize: 44,
    appearance,
    variation,
    tintHex,
  });
  const canvas = document.createElement('canvas');
  canvas.width = rendered.width;
  canvas.height = rendered.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(rendered.rgba), rendered.width, rendered.height),
    0,
    0,
  );
  const url = canvas.toDataURL('image/png');
  previewUrlCache.set(key, url);
  return url;
}

export function IconAppearancePicker({
  appearance,
  variation,
  tintColor,
  systemDark,
  isHubConnected,
  onChange,
}: {
  appearance: IconAppearance;
  variation: IconVariation;
  tintColor: IconTintColor;
  systemDark: boolean;
  isHubConnected: boolean;
  onChange: (patch: {
    iconAppearance?: IconAppearance;
    iconVariation?: IconVariation;
    iconTintColor?: IconTintColor;
  }) => void;
}) {
  const [hubStatus, setHubStatus] = useState<HubIconCacheStatus | null>(null);
  const resolvedVariation = resolveIconVariation(variation, systemDark);
  const resolvedTintHex = resolveIconTintColor(tintColor);

  const previews = useMemo(() => {
    const out: Record<IconAppearance, string> = {
      default: renderPreviewDataUrl('default', resolvedVariation, resolvedTintHex),
      dark: renderPreviewDataUrl('dark', 'dark', resolvedTintHex),
      clear: renderPreviewDataUrl('clear', resolvedVariation, resolvedTintHex),
      tinted: renderPreviewDataUrl('tinted', resolvedVariation, resolvedTintHex),
    };
    return out;
  }, [resolvedVariation, resolvedTintHex]);

  useEffect(() => {
    if (!isHubConnected || !window.hausNative) {
      setHubStatus(null);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const status = await window.hausNative?.helper<HubIconCacheStatus>({
          method: 'GET',
          path: '/api/brands/status',
        });
        if (alive && status && typeof status.version === 'string') {
          setHubStatus(status);
        }
      } catch {
        // Older Hubs without /api/brands/status omit this indicator cleanly.
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, 5_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [isHubConnected]);

  const showVariation = appearance !== 'dark';
  const showTint = appearance === 'tinted';
  const isWarming = Boolean(hubStatus && (hubStatus.queued > 0 || hubStatus.active > 0));

  return (
    <Box className="icon-appearance-picker">
      <Box className="icon-appearance-header">
        <Text>Icon &amp; integration style</Text>
        {hubStatus && (
          <Text semantic="small" className="icon-cache-badge">
            {isWarming
              ? `Preparing icons… ${hubStatus.ready}/${Math.max(hubStatus.ready, hubStatus.inventory)}`
              : `${hubStatus.ready} cached · ${hubStatus.engine === 'cpp' ? 'C++' : 'TS'}`}
          </Text>
        )}
      </Box>

      <Box className="icon-style-gallery" role="radiogroup" ariaLabel="Icon style">
        {ICON_APPEARANCES.map((option) => {
          const selected = appearance === option.value;
          const previewUrl = previews[option.value];
          return (
            <Pressable
              key={option.value}
              type="button"
              role="radio"
              ariaChecked={selected}
              className={`icon-style-card${selected ? ' is-selected' : ''}`}
              onPress={() => onChange({ iconAppearance: option.value })}
            >
              <Text
                className={`icon-style-preview is-mode-${option.value}${
                  option.value !== 'dark' ? ` is-var-${resolvedVariation}` : ''
                }`}
              >
                {previewUrl && <HausImage src={previewUrl} alt="" />}
              </Text>
              <Text className="icon-style-label">{option.title}</Text>
            </Pressable>
          );
        })}
      </Box>

      {showVariation && (
        <Box className="settings-row icon-style-subrow">
          <Text>
            {appearance === 'default'
              ? 'Default style'
              : appearance === 'clear'
                ? 'Clear style'
                : 'Tinted style'}
          </Text>
          <Box className="segmented" role="radiogroup" ariaLabel="Icon variation">
            {ICON_VARIATIONS.map((option) => (
              <Pressable
                key={option.value}
                type="button"
                role="radio"
                ariaChecked={variation === option.value}
                className={variation === option.value ? 'selected' : ''}
                onPress={() => onChange({ iconVariation: option.value })}
              >
                {option.title}
              </Pressable>
            ))}
          </Box>
        </Box>
      )}

      {showTint && (
        <Box className="icon-tint-section">
          <Box className="icon-tint-header">
            <Text>Tint color</Text>
            <Text semantic="small">
              {ICON_TINT_COLORS.find((c) => c.value === tintColor)?.title ?? 'Automatic'}
            </Text>
          </Box>
          <Box className="icon-tint-swatches" role="radiogroup" ariaLabel="Tinted icon color">
            {ICON_TINT_COLORS.map((color) => {
              const selected = tintColor === color.value;
              return (
                <Pressable
                  key={color.value}
                  type="button"
                  role="radio"
                  ariaChecked={selected}
                  ariaLabel={color.title}
                  title={color.title}
                  className={`icon-tint-swatch${selected ? ' is-selected' : ''}${
                    color.value === 'automatic' ? ' is-automatic' : ''
                  }`}
                  surfaceTokens={color.hex ? { backgroundColor: color.hex } : undefined}
                  onPress={() => onChange({ iconTintColor: color.value })}
                />
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}
