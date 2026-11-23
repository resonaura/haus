/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import {
  buildLiquidGlassDisplacementMap,
  DEFAULT_LIQUID_GLASS_SETTINGS,
  sanitizeLiquidGlassSettings,
  uniformsFromLiquidGlassSettings,
  type LiquidGlassSettings,
} from '../ir/liquid-glass-shader.js';

export interface UseLiquidGlassSurfaceOptions {
  readonly settings?: Partial<LiquidGlassSettings> | null;
  readonly cornerRadiusPx?: number;
  readonly isDark?: boolean;
}

export interface LiquidGlassSurfaceBinding<TElement extends HTMLElement = HTMLElement> {
  readonly ref: React.RefObject<TElement | null>;
  readonly filterSvg: React.ReactElement | null;
  readonly style: React.CSSProperties;
  readonly enabled: boolean;
  readonly settings: LiquidGlassSettings;
}

/**
 * React hook binding Haus Liquid Glass Snell's law convex bevel lens refraction,
 * chromatic prism dispersion, blur/tint scaling, and rim lighting parameters
 * to a live DOM surface via SVG `backdrop-filter: url(#...)`.
 */
export function useLiquidGlassSurface<TElement extends HTMLElement = HTMLElement>(
  options: UseLiquidGlassSurfaceOptions = {},
): LiquidGlassSurfaceBinding<TElement> {
  const settings = React.useMemo(
    () => sanitizeLiquidGlassSettings({ ...DEFAULT_LIQUID_GLASS_SETTINGS, ...options.settings }),
    [options.settings],
  );
  const cornerRadiusPx = options.cornerRadiusPx ?? 32;
  const isDark = options.isDark ?? true;
  const reactId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const filterId = `haus-lg-${reactId}`;

  const ref = React.useRef<TElement | null>(null);
  const [size, setSize] = React.useState<{ readonly width: number; readonly height: number }>({
    width: 0,
    height: 0,
  });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !settings.enabled) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const nextW = Math.round(rect.width);
      const nextH = Math.round(rect.height);
      setSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [settings.enabled]);

  const displacement = React.useMemo(() => {
    if (!settings.enabled || size.width < 24 || size.height < 20) return null;
    return buildLiquidGlassDisplacementMap({
      width: size.width,
      height: size.height,
      cornerRadius: cornerRadiusPx,
      settings,
    });
  }, [cornerRadiusPx, settings, size.height, size.width]);

  const uniforms = React.useMemo(
    () => uniformsFromLiquidGlassSettings(settings, 1, isDark, cornerRadiusPx),
    [cornerRadiusPx, isDark, settings],
  );

  const filterSvg = React.useMemo<React.ReactElement | null>(() => {
    if (!settings.enabled || !displacement || size.width < 24 || size.height < 20) {
      return null;
    }
    const blurStdDev = Number(Math.max(0.8, uniforms.u_blur_radius * 0.48).toFixed(2));
    const baseScale = displacement.maxScalePx;
    const chromaShift = Number((3.5 * settings.dispersion * 4.0).toFixed(2));
    const scaleR = Number((baseScale + chromaShift).toFixed(2));
    const scaleG = Number(baseScale.toFixed(2));
    const scaleB = Number(Math.max(0, baseScale - chromaShift).toFixed(2));
    const hasChroma = settings.dispersion >= 0.005 && baseScale > 0.5;

    return (
      <svg
        aria-hidden="true"
        width="0"
        height="0"
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        <defs>
          <filter
            id={filterId}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={size.width}
            height={size.height}
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation={blurStdDev}
              edgeMode="duplicate"
              result="frosted"
            />
            <feImage
              href={displacement.dataUrl}
              x="0"
              y="0"
              width={size.width}
              height={size.height}
              preserveAspectRatio="none"
              result="bevelMap"
            />
            {hasChroma ? (
              <>
                <feDisplacementMap
                  in="frosted"
                  in2="bevelMap"
                  scale={scaleR}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="dispR"
                />
                <feColorMatrix
                  in="dispR"
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="chanR"
                />
                <feDisplacementMap
                  in="frosted"
                  in2="bevelMap"
                  scale={scaleG}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="dispG"
                />
                <feColorMatrix
                  in="dispG"
                  type="matrix"
                  values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="chanG"
                />
                <feDisplacementMap
                  in="frosted"
                  in2="bevelMap"
                  scale={scaleB}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="dispB"
                />
                <feColorMatrix
                  in="dispB"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                  result="chanB"
                />
                <feBlend in="chanR" in2="chanG" mode="screen" result="rg" />
                <feBlend in="rg" in2="chanB" mode="screen" result="refracted" />
              </>
            ) : (
              <feDisplacementMap
                in="frosted"
                in2="bevelMap"
                scale={scaleG}
                xChannelSelector="R"
                yChannelSelector="G"
                result="refracted"
              />
            )}
            <feColorMatrix
              in="refracted"
              type="saturate"
              values={String(Number(settings.saturation.toFixed(3)))}
              result="saturated"
            />
          </filter>
        </defs>
      </svg>
    );
  }, [
    displacement,
    filterId,
    settings.dispersion,
    settings.enabled,
    settings.saturation,
    size.height,
    size.width,
    uniforms.u_blur_radius,
  ]);

  const style = React.useMemo<React.CSSProperties>(() => {
    if (!settings.enabled) return {};
    const r = Math.round(uniforms.u_tint_r * 255);
    const g = Math.round(uniforms.u_tint_g * 255);
    const b = Math.round(uniforms.u_tint_b * 255);
    const a = Number(uniforms.u_tint_a.toFixed(3));
    const fallbackBlur = `blur(${Math.round(uniforms.u_blur_radius * 0.65)}px) saturate(${Math.round(settings.saturation * 100)}%)`;
    const activeFilter = displacement ? `url(#${filterId})` : fallbackBlur;

    const rimAlpha = Number(
      ((isDark ? 0.22 : 0.55) * (0.5 + settings.specularDial * 0.5)).toFixed(3),
    );
    const edgeDarkAlpha = Number(
      Math.max(0, Math.min(0.25, settings.darkenedEdge * 1.4)).toFixed(3),
    );

    const styleMap: React.CSSProperties & Record<string, string | number | undefined> = {
      background: `linear-gradient(165deg, rgba(255, 255, 255, ${Number((settings.edgeHighlight * (isDark ? 0.11 : 0.24)).toFixed(3))}), transparent 48%), rgba(${r}, ${g}, ${b}, ${a})`,
      backdropFilter: activeFilter,
      WebkitBackdropFilter: activeFilter,
      boxShadow: [
        `inset 0 1px 0 0 rgba(255, 255, 255, ${rimAlpha})`,
        `inset 0 -0.5px 0 0 rgba(255, 255, 255, ${Number((rimAlpha * 0.45).toFixed(3))})`,
        edgeDarkAlpha > 0
          ? `0 0 0 1px rgba(0, 0, 0, ${edgeDarkAlpha}), 0 10px 28px rgba(0, 0, 0, ${isDark ? 0.34 : 0.14})`
          : `0 10px 28px rgba(0, 0, 0, ${isDark ? 0.32 : 0.12})`,
      ].join(', '),
      '--haus-lg-bevel-width': `${settings.edgeWidth}px`,
      '--haus-lg-refraction': String(settings.refractionStrength),
      '--haus-lg-dispersion': String(settings.dispersion),
      '--haus-lg-blur-radius': `${Math.round(uniforms.u_blur_radius)}px`,
    };
    return styleMap;
  }, [displacement, filterId, isDark, settings, uniforms]);

  return {
    ref,
    filterSvg,
    style,
    enabled: settings.enabled,
    settings,
  };
}
