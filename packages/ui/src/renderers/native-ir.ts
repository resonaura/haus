/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { LayoutStyle, ViewportMetrics } from '../ir/geometry.js';
import type { MaterialIR, RimLightingPreset, ShaderUniformValue } from '../ir/materials.js';
import {
  normalizeMaterialIR,
  resolveStyleForViewport,
  type ThemeMode,
  type UiNode,
  type UiNodeKind,
} from '../ir/node.js';
import {
  resolveColorToRgbaTuple,
  resolveLengthToPx,
  type RenderContext,
  type UiRenderer,
} from './contract.js';

export type RgbaFloat4 = readonly [number, number, number, number];

export interface TaffyDimensionIR {
  readonly kind: 'px' | 'percent' | 'auto';
  readonly value: number;
}

export interface TaffyEdgesIR {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface TaffyLayoutBoxIR {
  readonly display: 'flex' | 'grid' | 'none';
  readonly flexDirection: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  readonly flexWrap: 'nowrap' | 'wrap' | 'wrap-reverse';
  readonly alignItems: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  readonly justifyContent: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
  readonly gapRowPx: number;
  readonly gapColumnPx: number;
  readonly gridColumns?: number;
  readonly width: TaffyDimensionIR;
  readonly minWidth?: TaffyDimensionIR;
  readonly maxWidth?: TaffyDimensionIR;
  readonly height: TaffyDimensionIR;
  readonly minHeight?: TaffyDimensionIR;
  readonly maxHeight?: TaffyDimensionIR;
  readonly paddingPx: TaffyEdgesIR;
  readonly marginPx: TaffyEdgesIR;
  readonly position: 'relative' | 'absolute';
  readonly flexGrow: number;
  readonly flexShrink: number;
  readonly zIndex: number;
  readonly clipChildren: boolean;
}

export interface NativeCornerGeometryIR {
  readonly radiiPx: readonly [number, number, number, number];
  /** Superellipse exponent: `1.0` = circular arc, `1.4` = Apple continuous squircle. */
  readonly superellipseExponent: number;
}

export interface NativeBackdropPassIR {
  readonly blurRadiusPx: number;
  readonly saturation: number;
  readonly brightness: number;
  readonly contrast: number;
  readonly tintRgba: RgbaFloat4;
  readonly noiseOpacity: number;
}

export interface NativeRimLightIR {
  readonly preset: RimLightingPreset;
  readonly specularIntensity: number;
  readonly diffuseDepthPx: number;
  readonly edgeDarkening: number;
  readonly cornerExponent: number;
  readonly colorRgba: RgbaFloat4;
}

export interface NativeShadowPassIR {
  readonly offsetXPx: number;
  readonly offsetYPx: number;
  readonly blurRadiusPx: number;
  readonly spreadRadiusPx: number;
  readonly colorRgba: RgbaFloat4;
  readonly inset: boolean;
}

export interface NativePaintPassIR {
  readonly fillKind: 'none' | 'solid' | 'gradient' | 'blur' | 'backdrop' | 'shader';
  readonly fillColorRgba: RgbaFloat4;
  readonly gradientStops?: readonly { readonly position: number; readonly colorRgba: RgbaFloat4 }[];
  readonly gradientAngleDeg?: number;
  readonly borderWidthPx: number;
  readonly borderColorRgba: RgbaFloat4;
  readonly corners: NativeCornerGeometryIR;
  readonly opacity: number;
  readonly shadows: readonly NativeShadowPassIR[];
  readonly backdrop?: NativeBackdropPassIR;
  readonly rimLight?: NativeRimLightIR;
  readonly shaderIndex?: number;
  readonly shaderUniforms?: Readonly<Record<string, ShaderUniformValue>>;
}

export interface NativeTypographyIR {
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly lineHeightPx: number;
  readonly fontWeight: number;
  readonly letterSpacingPx: number;
  readonly colorRgba: RgbaFloat4;
  readonly align: 'left' | 'center' | 'right';
  readonly truncate: boolean;
  readonly tabularNums: boolean;
}

export interface NativeSceneNodeIR {
  readonly index: number;
  readonly parentIndex: number | null;
  readonly childIndices: readonly number[];
  readonly kind: UiNodeKind;
  readonly id?: string;
  readonly layout: TaffyLayoutBoxIR;
  readonly paint: NativePaintPassIR;
  readonly typography?: NativeTypographyIR;
  readonly text?: string;
  readonly imageSrc?: string;
  readonly interactive?: {
    readonly disabled: boolean;
    readonly selected: boolean;
    readonly checked: boolean;
    readonly value?: string | number;
    readonly progress?: number;
  };
}

export interface NativeCompiledShaderIR {
  readonly index: number;
  readonly shaderId: string;
  readonly wgslSource: string;
  readonly glslSource: string;
  readonly defaultUniforms: Readonly<Record<string, ShaderUniformValue>>;
}

export interface HausSceneGraphIR {
  readonly schema: 'haus.ui.ir/v1';
  readonly themeMode: ThemeMode;
  readonly viewport: ViewportMetrics;
  readonly rootNodeIndex: number;
  readonly nodes: readonly NativeSceneNodeIR[];
  readonly shaders: readonly NativeCompiledShaderIR[];
}

function toTaffyDimension(resolved: number | `${number}%` | 'auto' | undefined): TaffyDimensionIR {
  if (resolved === undefined || resolved === 'auto') return { kind: 'auto', value: 0 };
  if (typeof resolved === 'number') return { kind: 'px', value: resolved };
  return { kind: 'percent', value: Number.parseFloat(resolved) || 0 };
}

function toPxNumber(resolved: number | `${number}%` | 'auto' | undefined): number {
  return typeof resolved === 'number' ? resolved : 0;
}

function buildTaffyLayout(
  layout: LayoutStyle | undefined,
  context: RenderContext,
): TaffyLayoutBoxIR {
  const { viewport } = context;
  const pxVal = (v: Parameters<typeof resolveLengthToPx>[0]) =>
    toPxNumber(resolveLengthToPx(v, viewport));
  const dimVal = (v: Parameters<typeof resolveLengthToPx>[0]) =>
    toTaffyDimension(resolveLengthToPx(v, viewport));
  const gapPx = pxVal(layout?.gap);
  const rowGapPx = layout?.rowGap !== undefined ? pxVal(layout.rowGap) : gapPx;
  const colGapPx = layout?.columnGap !== undefined ? pxVal(layout.columnGap) : gapPx;
  const gridColCount =
    typeof layout?.gridColumns === 'number'
      ? layout.gridColumns
      : Array.isArray(layout?.gridColumns)
        ? layout.gridColumns.length
        : undefined;

  return {
    display:
      layout?.display === 'none'
        ? 'none'
        : layout?.display === 'grid' || gridColCount !== undefined
          ? 'grid'
          : 'flex',
    flexDirection: layout?.direction ?? 'column',
    flexWrap: layout?.wrap ?? 'nowrap',
    alignItems: layout?.alignItems ?? 'stretch',
    justifyContent: layout?.justifyContent ?? 'start',
    gapRowPx: rowGapPx,
    gapColumnPx: colGapPx,
    ...(gridColCount !== undefined ? { gridColumns: gridColCount } : {}),
    width: dimVal(layout?.width),
    ...(layout?.minWidth ? { minWidth: dimVal(layout.minWidth) } : {}),
    ...(layout?.maxWidth ? { maxWidth: dimVal(layout.maxWidth) } : {}),
    height: dimVal(layout?.height),
    ...(layout?.minHeight ? { minHeight: dimVal(layout.minHeight) } : {}),
    ...(layout?.maxHeight ? { maxHeight: dimVal(layout.maxHeight) } : {}),
    paddingPx: {
      top: pxVal(layout?.padding?.top),
      right: pxVal(layout?.padding?.right),
      bottom: pxVal(layout?.padding?.bottom),
      left: pxVal(layout?.padding?.left),
    },
    marginPx: {
      top: pxVal(layout?.margin?.top),
      right: pxVal(layout?.margin?.right),
      bottom: pxVal(layout?.margin?.bottom),
      left: pxVal(layout?.margin?.left),
    },
    position:
      layout?.position === 'absolute' || layout?.position === 'fixed' ? 'absolute' : 'relative',
    flexGrow: layout?.flexGrow ?? 0,
    flexShrink: layout?.flexShrink ?? 1,
    zIndex: layout?.zIndex ?? 0,
    clipChildren: layout?.overflow === 'hidden',
  };
}

/**
 * Pluggable OOP Native Scene Graph renderer targeting Rust (`wgpu` + `Taffy`)
 * and C++ (`Skia` + `Yoga`) engines with WGSL/GLSL shader pass compilation.
 */
export class NativeSceneGraphRenderer implements UiRenderer<HausSceneGraphIR> {
  readonly target = 'native-ir' as const;

  render(root: UiNode, context: RenderContext): HausSceneGraphIR {
    const nodes: Array<NativeSceneNodeIR | undefined> = [];
    const shaders: NativeCompiledShaderIR[] = [];
    const shaderIndexById = new Map<string, number>();

    const registerShader = (
      material: Extract<MaterialIR, { readonly kind: 'shader' }>,
    ): number | undefined => {
      const pass = material.passes[0];
      if (!pass) return undefined;
      const existing = shaderIndexById.get(pass.id);
      if (existing !== undefined) return existing;
      const registered = context.shaderRegistry.get(pass.id) ?? pass;
      const idx = shaders.length;
      shaders.push({
        index: idx,
        shaderId: registered.id,
        wgslSource: registered.targets.wgsl ?? '',
        glslSource: registered.targets.glsl ?? '',
        defaultUniforms: registered.uniforms,
      });
      shaderIndexById.set(pass.id, idx);
      return idx;
    };

    const visit = (node: UiNode, parentIndex: number | null): number => {
      const myIndex = nodes.length;
      nodes.push(undefined);

      const resolved = resolveStyleForViewport(
        node.style,
        context.viewport.width,
        context.theme.palette.breakpoints,
      );
      const layout = buildTaffyLayout(resolved.layout, context);
      const material = normalizeMaterialIR(resolved.material);

      const corners: NativeCornerGeometryIR = resolved.corners
        ? {
            radiiPx: [
              resolved.corners.topLeft,
              resolved.corners.topRight,
              resolved.corners.bottomRight,
              resolved.corners.bottomLeft,
            ],
            superellipseExponent:
              resolved.corners.shape === 'superellipse' ? (resolved.corners.exponent ?? 1.4) : 1.0,
          }
        : { radiiPx: [0, 0, 0, 0], superellipseExponent: 1.0 };

      const borderWidthPx =
        resolved.border && resolved.border.style !== 'none' ? resolved.border.width : 0;
      const borderColorRgba: RgbaFloat4 = resolved.border
        ? resolveColorToRgbaTuple(resolved.border.color, context.theme)
        : [0, 0, 0, 0];

      const shadows: NativeShadowPassIR[] = (resolved.shadows ?? []).map((s) => ({
        offsetXPx: s.offsetX,
        offsetYPx: s.offsetY,
        blurRadiusPx: s.blurRadius,
        spreadRadiusPx: s.spreadRadius ?? 0,
        colorRgba: resolveColorToRgbaTuple(s.color, context.theme),
        inset: Boolean(s.inset),
      }));

      let fillKind: NativePaintPassIR['fillKind'] = 'none';
      let fillColorRgba: RgbaFloat4 = [0, 0, 0, 0];
      let gradientStops: NativePaintPassIR['gradientStops'];
      let gradientAngleDeg: number | undefined;
      let backdrop: NativeBackdropPassIR | undefined;
      let rimLight: NativeRimLightIR | undefined;
      let shaderIndex: number | undefined;
      let shaderUniforms: Readonly<Record<string, ShaderUniformValue>> | undefined;

      const rimColorRgba = resolveColorToRgbaTuple(
        context.theme.color('materialRim'),
        context.theme,
      );

      if (material) {
        fillKind = material.kind;
        switch (material.kind) {
          case 'solid':
            fillColorRgba = resolveColorToRgbaTuple(material.color, context.theme);
            break;
          case 'gradient':
            gradientAngleDeg = material.angleDeg;
            gradientStops = material.stops.map((stop) => ({
              position: stop.offset,
              colorRgba: resolveColorToRgbaTuple(stop.color, context.theme),
            }));
            if (gradientStops[0]) fillColorRgba = gradientStops[0].colorRgba;
            break;
          case 'blur':
            if (material.tint) {
              fillColorRgba = resolveColorToRgbaTuple(material.tint, context.theme);
            }
            backdrop = {
              blurRadiusPx: material.blur.radius,
              saturation: 1,
              brightness: 1,
              contrast: 1,
              tintRgba: fillColorRgba,
              noiseOpacity: 0,
            };
            break;
          case 'backdrop': {
            const tintColor = material.backdrop.tintColor ?? material.fallbackColor;
            fillColorRgba = resolveColorToRgbaTuple(tintColor, context.theme);
            backdrop = {
              blurRadiusPx: material.backdrop.blurRadius,
              saturation: material.backdrop.saturation ?? 1,
              brightness: material.backdrop.brightness ?? 1,
              contrast: material.backdrop.contrast ?? 1,
              tintRgba: fillColorRgba,
              noiseOpacity: material.backdrop.noiseOpacity ?? 0,
            };
            if (material.rimLighting) {
              rimLight = {
                preset: material.rimLighting.preset,
                specularIntensity: material.rimLighting.specularIntensity,
                diffuseDepthPx: material.rimLighting.diffuseDepth,
                edgeDarkening: material.rimLighting.edgeDarkening,
                cornerExponent: material.rimLighting.cornerExponent,
                colorRgba: rimColorRgba,
              };
            }
            break;
          }
          case 'shader': {
            const tintColor = material.backdrop?.tintColor ?? material.fallbackColor;
            fillColorRgba = resolveColorToRgbaTuple(tintColor, context.theme);
            shaderIndex = registerShader(material);
            shaderUniforms = material.passes[0]?.uniforms;
            if (material.backdrop) {
              backdrop = {
                blurRadiusPx: material.backdrop.blurRadius,
                saturation: material.backdrop.saturation ?? 1,
                brightness: material.backdrop.brightness ?? 1,
                contrast: material.backdrop.contrast ?? 1,
                tintRgba: fillColorRgba,
                noiseOpacity: material.backdrop.noiseOpacity ?? 0,
              };
            }
            if (material.rimLighting) {
              rimLight = {
                preset: material.rimLighting.preset,
                specularIntensity: material.rimLighting.specularIntensity,
                diffuseDepthPx: material.rimLighting.diffuseDepth,
                edgeDarkening: material.rimLighting.edgeDarkening,
                cornerExponent: material.rimLighting.cornerExponent,
                colorRgba: rimColorRgba,
              };
            }
            break;
          }
        }
      }

      let typography: NativeTypographyIR | undefined;
      if (resolved.typography || node.props.text !== undefined) {
        const t = resolved.typography;
        const fontSizePx = t?.size ?? 14;
        const lineHeightPx =
          t?.lineHeight !== undefined
            ? t.lineHeight <= 4
              ? Number((fontSizePx * t.lineHeight).toFixed(2))
              : t.lineHeight
            : Number((fontSizePx * 1.4).toFixed(2));
        typography = {
          fontFamily: context.theme.palette.fontFamilies[t?.fontFamily ?? 'sans'],
          fontSizePx,
          lineHeightPx,
          fontWeight: t?.weight ?? 400,
          letterSpacingPx: Number(((t?.letterSpacing ?? 0) * fontSizePx).toFixed(2)),
          colorRgba: resolveColorToRgbaTuple(
            t?.color ?? context.theme.color('textPrimary'),
            context.theme,
          ),
          align: t?.align ?? 'left',
          truncate: Boolean(t?.truncate),
          tabularNums: Boolean(t?.tabularNums),
        };
      }

      const childIndices = node.children.map((child) => visit(child, myIndex));

      nodes[myIndex] = {
        index: myIndex,
        parentIndex,
        childIndices,
        kind: node.kind,
        ...(node.id ? { id: node.id } : {}),
        layout,
        paint: {
          fillKind,
          fillColorRgba,
          ...(gradientStops ? { gradientStops } : {}),
          ...(gradientAngleDeg !== undefined ? { gradientAngleDeg } : {}),
          borderWidthPx,
          borderColorRgba,
          corners,
          opacity: resolved.opacity ?? 1,
          shadows,
          ...(backdrop ? { backdrop } : {}),
          ...(rimLight ? { rimLight } : {}),
          ...(shaderIndex !== undefined ? { shaderIndex } : {}),
          ...(shaderUniforms ? { shaderUniforms } : {}),
        },
        ...(typography ? { typography } : {}),
        ...(node.props.text !== undefined ? { text: node.props.text } : {}),
        ...(node.props.src ? { imageSrc: node.props.src } : {}),
        ...(node.kind === 'button' ||
        node.kind === 'switch' ||
        node.kind === 'slider' ||
        node.kind === 'input' ||
        node.kind === 'select' ||
        node.kind === 'progress'
          ? {
              interactive: {
                disabled: Boolean(node.props.disabled),
                selected: Boolean(node.props.selected),
                checked: Boolean(node.props.checked),
                ...(node.props.value !== undefined ? { value: node.props.value } : {}),
                ...(node.props.progress !== undefined ? { progress: node.props.progress } : {}),
              },
            }
          : {}),
      };

      return myIndex;
    };

    visit(root, null);

    return {
      schema: 'haus.ui.ir/v1',
      themeMode: context.theme.mode,
      viewport: context.viewport,
      rootNodeIndex: 0,
      nodes: nodes.filter((n): n is NativeSceneNodeIR => n !== undefined),
      shaders,
    };
  }
}
