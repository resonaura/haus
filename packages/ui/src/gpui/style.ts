/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  CustomShaderDesc,
  LiquidGlassDesc,
  StyleDesc,
  TransformDesc,
  TransformOriginDesc,
} from '@gpuix/react';
import {
  PILL_RADIUS_THRESHOLD,
  superellipseToContinuousRadiusRatio,
  type TransformSpec,
} from '../ir/geometry.js';
import type { ShaderUniformValue } from '../ir/materials.js';
import {
  normalizeMaterialIR,
  UiNode,
  type UiInteractiveStateStyle,
  type UiStyleSpec,
} from '../ir/node.js';
import {
  resolveColorToCss,
  resolveColorToSrgb,
  type RenderContext,
} from '../renderers/contract.js';
import { ReactNativeRenderer } from '../renderers/react-native.js';

const rnRenderer = new ReactNativeRenderer();

interface MaterialResolution {
  readonly clearBackgroundColor?: boolean;
  readonly background?: StyleDesc['background'];
  readonly backgroundColor?: string;
  readonly backdropBlur?: number;
  readonly blur?: number;
  readonly cornerSmoothing?: number;
  readonly liquidGlass?: LiquidGlassDesc;
  readonly shader?: CustomShaderDesc;
}

function readUniformNumber(
  uniforms: Readonly<Record<string, ShaderUniformValue>> | undefined,
  key: string,
): number | undefined {
  const entry = uniforms?.[key];
  return entry?.type === 'f32' ? entry.value : undefined;
}

function resolveTransform(spec: TransformSpec | undefined): {
  readonly transform?: TransformDesc;
  readonly transformOrigin?: TransformOriginDesc;
} {
  if (!spec) return {};
  const hasMatrix = spec.matrix !== undefined && spec.matrix.length === 6;
  const hasFields =
    spec.translateX !== undefined ||
    spec.translateY !== undefined ||
    spec.scale !== undefined ||
    spec.scaleX !== undefined ||
    spec.scaleY !== undefined ||
    spec.rotateDeg !== undefined ||
    spec.skewXDeg !== undefined ||
    spec.skewYDeg !== undefined ||
    hasMatrix;
  const transform: TransformDesc | undefined = hasFields
    ? {
        ...(spec.translateX !== undefined ? { translateX: spec.translateX } : {}),
        ...(spec.translateY !== undefined ? { translateY: spec.translateY } : {}),
        ...(spec.scale !== undefined ? { scale: spec.scale } : {}),
        ...(spec.scaleX !== undefined ? { scaleX: spec.scaleX } : {}),
        ...(spec.scaleY !== undefined ? { scaleY: spec.scaleY } : {}),
        ...(spec.rotateDeg !== undefined ? { rotate: spec.rotateDeg } : {}),
        ...(spec.skewXDeg !== undefined ? { skewX: spec.skewXDeg } : {}),
        ...(spec.skewYDeg !== undefined ? { skewY: spec.skewYDeg } : {}),
        ...(hasMatrix && spec.matrix
          ? {
              matrix: [
                spec.matrix[0],
                spec.matrix[1],
                spec.matrix[2],
                spec.matrix[3],
                spec.matrix[4],
                spec.matrix[5],
              ],
            }
          : {}),
      }
    : undefined;
  const transformOrigin: TransformOriginDesc | undefined =
    spec.originX !== undefined || spec.originY !== undefined
      ? { x: spec.originX ?? 0.5, y: spec.originY ?? 0.5 }
      : undefined;
  return { transform, transformOrigin };
}

function scaleGpuiCornerRadius(radius: number, ratio: number): number {
  if (radius <= 0 || radius >= PILL_RADIUS_THRESHOLD) return radius;
  return Number((radius * ratio).toFixed(2));
}

function resolveGpuiCorners(style: UiStyleSpec | undefined): {
  readonly cornerSmoothing?: number;
  readonly borderTopLeftRadius?: number;
  readonly borderTopRightRadius?: number;
  readonly borderBottomRightRadius?: number;
  readonly borderBottomLeftRadius?: number;
} {
  const c = style?.corners;
  if (!c) return {};
  const maxRadius = Math.max(c.topLeft, c.topRight, c.bottomRight, c.bottomLeft);
  if (c.shape === 'superellipse' && maxRadius > 0 && maxRadius < PILL_RADIUS_THRESHOLD) {
    const ratio = superellipseToContinuousRadiusRatio(c.exponent ?? 1.4);
    return {
      cornerSmoothing: 1,
      borderTopLeftRadius: scaleGpuiCornerRadius(c.topLeft, ratio),
      borderTopRightRadius: scaleGpuiCornerRadius(c.topRight, ratio),
      borderBottomRightRadius: scaleGpuiCornerRadius(c.bottomRight, ratio),
      borderBottomLeftRadius: scaleGpuiCornerRadius(c.bottomLeft, ratio),
    };
  }
  return { cornerSmoothing: 0 };
}

function resolveShadows(
  style: UiStyleSpec | undefined,
  context: RenderContext,
): StyleDesc['boxShadow'] {
  const shadows = style?.shadows;
  if (!shadows || shadows.length === 0) return undefined;
  return shadows.map((shadow) => ({
    offsetX: shadow.offsetX,
    offsetY: shadow.offsetY,
    blurRadius: shadow.blurRadius,
    spreadRadius: shadow.spreadRadius ?? 0,
    color: resolveColorToCss(shadow.color, context.theme, false),
    ...(shadow.inset ? { inset: true } : {}),
  }));
}

function resolveTintCss(
  color: Parameters<typeof resolveColorToSrgb>[0] | undefined,
  opacityOverride: number | undefined,
  context: RenderContext,
): string | undefined {
  if (!color) return undefined;
  const [r, g, b, a] = resolveColorToSrgb(color, context.theme);
  const alpha = opacityOverride !== undefined && a >= 0.99 ? opacityOverride : a;
  return `rgba(${r}, ${g}, ${b}, ${Number(Math.max(0, Math.min(1, alpha)).toFixed(3))})`;
}

function resolveMaterial(
  style: UiStyleSpec | undefined,
  context: RenderContext,
): MaterialResolution {
  const material = normalizeMaterialIR(style?.material);
  if (!material) return {};

  switch (material.kind) {
    case 'solid':
      return material.blur ? { blur: material.blur.radius * 0.5 } : {};
    case 'gradient': {
      const srgbStops = material.stops.map((stop) => ({
        position: stop.offset,
        srgb: resolveColorToSrgb(stop.color, context.theme),
      }));
      const stops = srgbStops.map((entry, idx) => {
        const [r, g, b, a] = entry.srgb;
        if (a <= 0.001) {
          const neighbor =
            srgbStops
              .slice(0, idx)
              .reverse()
              .find((s) => s.srgb[3] > 0.001) ??
            srgbStops.slice(idx + 1).find((s) => s.srgb[3] > 0.001);
          const [nr, ng, nb] = neighbor ? neighbor.srgb : [r, g, b];
          return { position: entry.position, color: `rgba(${nr}, ${ng}, ${nb}, 0)` };
        }
        return {
          position: entry.position,
          color:
            a >= 0.999
              ? `rgb(${r}, ${g}, ${b})`
              : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`,
        };
      });
      if (stops.length < 2) return {};
      const gradientBlur =
        material.blur && material.blur.radius > 0 ? material.blur.radius * 0.5 : undefined;
      if (material.gradientType === 'radial') {
        const centerX = material.radial?.centerX ?? 0.5;
        const centerY = material.radial?.centerY ?? 0.5;
        const radiusX =
          material.radial?.radiusX ??
          (material.radial ? Math.max(centerX, 1 - centerX) * Math.SQRT2 : 0.5);
        const radiusY =
          material.radial?.radiusY ??
          (material.radial ? Math.max(centerY, 1 - centerY) * Math.SQRT2 : 0.5);
        return {
          clearBackgroundColor: true,
          ...(gradientBlur !== undefined ? { blur: gradientBlur } : {}),
          background: {
            type: 'radial-gradient',
            stops,
            centerX,
            centerY,
            radiusX,
            radiusY,
          },
        };
      }
      return {
        clearBackgroundColor: true,
        ...(gradientBlur !== undefined ? { blur: gradientBlur } : {}),
        background: { type: 'linear-gradient', angle: material.angleDeg, stops },
      };
    }
    case 'blur':
      return {
        clearBackgroundColor: !material.tint,
        backgroundColor: material.tint
          ? resolveTintCss(material.tint, material.opacity, context)
          : undefined,
        backdropBlur: material.blur.radius * 0.5,
      };
    case 'backdrop':
      if (context.viewport.reducedTransparency) {
        return {
          clearBackgroundColor: true,
          backgroundColor: resolveColorToCss(material.fallbackColor, context.theme, false),
        };
      }
      return {
        clearBackgroundColor: true,
        backgroundColor: resolveTintCss(
          material.backdrop.tintColor ?? material.fallbackColor,
          material.backdrop.tintOpacity,
          context,
        ),
        backdropBlur: material.backdrop.blurRadius * 0.5,
      };
    case 'shader': {
      const pass = material.passes[0];
      const dark = context.theme.mode === 'dark';
      if (pass?.id === 'haus.liquid-glass.v1') {
        const rawRefr = readUniformNumber(pass.uniforms, 'refractionStrength') ?? 16;
        const rawDisp = readUniformNumber(pass.uniforms, 'dispersion') ?? 0.65;
        const rawBlur =
          readUniformNumber(pass.uniforms, 'blurRadius') ?? material.backdrop?.blurRadius ?? 20;
        const rawTintOp =
          readUniformNumber(pass.uniforms, 'tintOpacity') ??
          material.backdrop?.tintOpacity ??
          (dark ? 0.34 : 0.28);
        const tintColorValue =
          pass.uniforms.tintColor?.type === 'color'
            ? pass.uniforms.tintColor.value
            : material.backdrop?.tintColor;
        const rawCornerRadius = style?.corners
          ? Math.max(
              style.corners.topLeft,
              style.corners.topRight,
              style.corners.bottomRight,
              style.corners.bottomLeft,
            )
          : undefined;
        const cornerRadius =
          rawCornerRadius !== undefined &&
          style?.corners?.shape === 'superellipse' &&
          rawCornerRadius < PILL_RADIUS_THRESHOLD
            ? scaleGpuiCornerRadius(
                rawCornerRadius,
                superellipseToContinuousRadiusRatio(style.corners.exponent ?? 1.4),
              )
            : rawCornerRadius;
        const rim = material.rimLighting;
        return {
          clearBackgroundColor: true,
          cornerSmoothing: 1,
          liquidGlass: {
            enabled: !context.viewport.reducedTransparency,
            blurRadius: rawBlur * 0.5,
            ...(cornerRadius !== undefined ? { cornerRadius } : {}),
            refractionStrength: rawRefr > 2 ? Math.min(1.5, rawRefr / 20) : rawRefr,
            dispersion: rawDisp > 0.35 ? rawDisp * 0.22 : rawDisp,
            saturation: material.backdrop?.saturation ?? (dark ? 1.28 : 1.22),
            specularDial: rim ? rim.specularIntensity : 0,
            edgeHighlight: rim ? 0.42 : 0,
            darkenedEdge: rim ? rim.edgeDarkening : 0,
            nativeRim: rim !== undefined,
            ...(tintColorValue
              ? { tintColor: resolveColorToCss(tintColorValue, context.theme, false) }
              : {}),
            tintOpacity: rawTintOp,
            isDark: dark,
          },
        };
      }
      if (pass?.targets.wgsl) {
        return {
          clearBackgroundColor: true,
          shader: {
            label: pass.id,
            wgsl: pass.targets.wgsl,
            samplesBackdrop: pass.samplesBackdrop,
            backdropBlurRadius: material.backdrop ? material.backdrop.blurRadius * 0.5 : undefined,
          },
        };
      }
      return material.backdrop
        ? {
            clearBackgroundColor: true,
            backgroundColor: resolveTintCss(
              material.backdrop.tintColor ?? material.fallbackColor,
              material.backdrop.tintOpacity,
              context,
            ),
            backdropBlur: material.backdrop.blurRadius * 0.5,
          }
        : {};
    }
  }
}

function overlayStyleDesc(
  overlay: UiInteractiveStateStyle | undefined,
  context: RenderContext,
): StyleDesc | undefined {
  if (!overlay) return undefined;
  const overlaySpec: UiStyleSpec = {
    ...(overlay.material ? { material: overlay.material } : {}),
    ...(overlay.border ? { border: overlay.border } : {}),
    ...(overlay.opacity !== undefined ? { opacity: overlay.opacity } : {}),
    ...(overlay.transform ? { transform: overlay.transform } : {}),
    ...(overlay.shadows ? { shadows: overlay.shadows } : {}),
    ...(overlay.cursor ? { cursor: overlay.cursor } : {}),
    ...(overlay.textColor ? { typography: { color: overlay.textColor } } : {}),
  };
  return buildSingleStyle(overlaySpec, context);
}

const HOST_PLATFORM = (globalThis as { readonly process?: { readonly platform?: string } }).process
  ?.platform;
const NATIVE_MONO_FONT =
  HOST_PLATFORM === 'win32' ? 'Consolas' : HOST_PLATFORM === 'linux' ? 'DejaVu Sans Mono' : 'Menlo';

function resolveGpuiFontFamily(
  token: 'sans' | 'mono' | 'display' | undefined,
  renderedFamily: string | undefined,
): string | undefined {
  if (token === 'sans' || token === 'display') return undefined;
  if (token === 'mono') return NATIVE_MONO_FONT;
  if (!renderedFamily) return undefined;
  if (renderedFamily.includes('-apple-system') || renderedFamily.includes('sans-serif')) {
    return undefined;
  }
  if (renderedFamily.includes('monospace')) return NATIVE_MONO_FONT;
  return renderedFamily;
}

function buildSingleStyle(style: UiStyleSpec | undefined, context: RenderContext): StyleDesc {
  const rendered = rnRenderer.render(new UiNode({ kind: 'box', style }), context).style;
  const {
    shadowColor: _sc,
    shadowOffset: _so,
    shadowOpacity: _sp,
    shadowRadius: _sr,
    elevation: _el,
    borderCurve: _bc,
    zIndex: _zi,
    textTransform: _tt,
    letterSpacing: _ls,
    fontFamily: rawFontFamily,
    ...cleanBase
  } = rendered;
  const gpuiFontFamily = resolveGpuiFontFamily(style?.typography?.fontFamily, rawFontFamily);

  const { layout } = style ?? {};
  const material = resolveMaterial(style, context);
  const { transform, transformOrigin } = resolveTransform(style?.transform);
  const boxShadow = resolveShadows(style, context);
  const gpuiCorners = resolveGpuiCorners(style);
  const cornerSmoothing = gpuiCorners.cornerSmoothing ?? material.cornerSmoothing;

  const resolved: StyleDesc = {
    ...cleanBase,
    ...(gpuiFontFamily !== undefined ? { fontFamily: gpuiFontFamily } : {}),
    ...(gpuiCorners.borderTopLeftRadius !== undefined
      ? {
          borderTopLeftRadius: gpuiCorners.borderTopLeftRadius,
          borderTopRightRadius: gpuiCorners.borderTopRightRadius,
          borderBottomRightRadius: gpuiCorners.borderBottomRightRadius,
          borderBottomLeftRadius: gpuiCorners.borderBottomLeftRadius,
        }
      : {}),
    ...(material.clearBackgroundColor ? { backgroundColor: undefined } : {}),
    ...(material.backgroundColor !== undefined
      ? { backgroundColor: material.backgroundColor }
      : {}),
    ...(material.background ? { background: material.background } : {}),
    ...(material.backdropBlur !== undefined ? { backdropBlur: material.backdropBlur } : {}),
    ...(material.blur !== undefined ? { blur: material.blur } : {}),
    ...(material.liquidGlass ? { liquidGlass: material.liquidGlass } : {}),
    ...(material.shader ? { shader: material.shader } : {}),
    ...(cornerSmoothing !== undefined ? { cornerSmoothing } : {}),
    ...(boxShadow ? { boxShadow } : {}),
    ...(transform ? { transform } : {}),
    ...(transformOrigin ? { transformOrigin } : {}),
    ...(layout?.position === 'sticky' ? { position: 'sticky' } : {}),
    ...(typeof layout?.gridColumns === 'number' ? { gridTemplateColumns: layout.gridColumns } : {}),
    ...(layout?.overflowX ? { overflowX: layout.overflowX } : {}),
    ...(layout?.overflowY ? { overflowY: layout.overflowY } : {}),
    ...(style?.pointerEvents ? { pointerEvents: style.pointerEvents } : {}),
    ...(style?.cursor ? { cursor: style.cursor } : {}),
  };
  return resolved;
}

/** Converts any `@haus/ui` `UiStyleSpec` into a native GPUIX compositor `StyleDesc`. */
export function styleFor(style: UiStyleSpec | undefined, context: RenderContext): StyleDesc {
  const base = buildSingleStyle(style, context);
  const hover = overlayStyleDesc(style?.states?.hover, context);
  const active = overlayStyleDesc(style?.states?.pressed, context);
  const focusVisible = overlayStyleDesc(style?.states?.focus, context);
  return {
    display:
      style?.layout?.display === 'grid' || style?.layout?.display === 'none'
        ? style.layout.display
        : 'flex',
    flexDirection: 'column',
    ...base,
    ...(hover ? { hover } : {}),
    ...(active ? { active } : {}),
    ...(focusVisible ? { focusVisible } : {}),
  };
}
