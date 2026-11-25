/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { LayoutStyle, TypographyStyle } from '../ir/geometry.js';
import type {
  BackdropEffect,
  MaterialIR,
  RimLightingPass,
  ShaderPassDescriptor,
} from '../ir/materials.js';
import {
  normalizeMaterialIR,
  resolveStyleForViewport,
  type UiNode,
  type UiNodeEvents,
  type UiNodeKind,
} from '../ir/node.js';
import {
  resolveColorToCss,
  resolveColorToSrgb,
  resolveLengthToPx,
  type RenderContext,
  type UiRenderer,
} from './contract.js';

export type ReactNativePrimitiveType =
  | 'View'
  | 'Text'
  | 'Pressable'
  | 'Image'
  | 'ScrollView'
  | 'TextInput'
  | 'BlurView'
  | 'ShaderSurfaceView';

export interface ReactNativeStyleSheet {
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
  justifyContent?:
    'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly';
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  width?: number | `${number}%` | 'auto';
  minWidth?: number | `${number}%` | 'auto';
  maxWidth?: number | `${number}%` | 'auto';
  height?: number | `${number}%` | 'auto';
  minHeight?: number | `${number}%` | 'auto';
  maxHeight?: number | `${number}%` | 'auto';
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  position?: 'relative' | 'absolute';
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  zIndex?: number;
  overflow?: 'visible' | 'hidden' | 'scroll';
  flexGrow?: number;
  flexShrink?: number;
  alignSelf?: 'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch';
  aspectRatio?: number;
  backgroundColor?: string;
  borderWidth?: number;
  borderColor?: string;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderCurve?: 'circular' | 'continuous';
  opacity?: number;
  shadowColor?: string;
  shadowOffset?: { readonly width: number; readonly height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  fontWeight?: '400' | '500' | '600' | '700';
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right';
  textTransform?: 'none' | 'uppercase';
}

export interface ReactNativeElementDescriptor {
  readonly component: ReactNativePrimitiveType;
  readonly kind: UiNodeKind;
  readonly id?: string;
  readonly style: ReactNativeStyleSheet;
  readonly props: Readonly<Record<string, unknown>>;
  readonly events: UiNodeEvents;
  readonly backdropEffect?: BackdropEffect;
  readonly shaderPass?: ShaderPassDescriptor;
  readonly rimLight?: RimLightingPass;
  readonly children: readonly (ReactNativeElementDescriptor | string)[];
}

function mapPrimitiveType(
  kind: UiNodeKind,
  material: MaterialIR | undefined,
  hasPress: boolean,
): ReactNativePrimitiveType {
  if (kind === 'text' || kind === 'heading') return 'Text';
  if (kind === 'image') return 'Image';
  if (kind === 'input') return 'TextInput';
  if (kind === 'scroll') return 'ScrollView';
  if (kind === 'button' || hasPress) return 'Pressable';
  if (material?.kind === 'shader') return 'ShaderSurfaceView';
  if (material?.kind === 'backdrop' || material?.kind === 'blur') return 'BlurView';
  return 'View';
}

function numericPx(val: number | `${number}%` | 'auto' | undefined): number | undefined {
  return typeof val === 'number' ? val : undefined;
}

function applyNativeLayout(
  layout: LayoutStyle,
  context: RenderContext,
  target: ReactNativeStyleSheet,
): void {
  const { viewport } = context;
  if (layout.direction) target.flexDirection = layout.direction;
  if (layout.wrap) target.flexWrap = layout.wrap;
  if (layout.alignItems) {
    target.alignItems =
      layout.alignItems === 'start'
        ? 'flex-start'
        : layout.alignItems === 'end'
          ? 'flex-end'
          : layout.alignItems;
  }
  if (layout.justifyContent) {
    target.justifyContent =
      layout.justifyContent === 'start'
        ? 'flex-start'
        : layout.justifyContent === 'end'
          ? 'flex-end'
          : layout.justifyContent === 'between'
            ? 'space-between'
            : layout.justifyContent === 'around'
              ? 'space-around'
              : layout.justifyContent === 'evenly'
                ? 'space-evenly'
                : 'center';
  }
  if (layout.gap) target.gap = numericPx(resolveLengthToPx(layout.gap, viewport));
  if (layout.rowGap) target.rowGap = numericPx(resolveLengthToPx(layout.rowGap, viewport));
  if (layout.columnGap) {
    target.columnGap = numericPx(resolveLengthToPx(layout.columnGap, viewport));
  }
  if (layout.width) target.width = resolveLengthToPx(layout.width, viewport);
  if (layout.minWidth) target.minWidth = resolveLengthToPx(layout.minWidth, viewport);
  if (layout.maxWidth) target.maxWidth = resolveLengthToPx(layout.maxWidth, viewport);
  if (layout.height) target.height = resolveLengthToPx(layout.height, viewport);
  if (layout.minHeight) target.minHeight = resolveLengthToPx(layout.minHeight, viewport);
  if (layout.maxHeight) target.maxHeight = resolveLengthToPx(layout.maxHeight, viewport);
  if (layout.padding) {
    target.paddingTop = numericPx(resolveLengthToPx(layout.padding.top, viewport));
    target.paddingRight = numericPx(resolveLengthToPx(layout.padding.right, viewport));
    target.paddingBottom = numericPx(resolveLengthToPx(layout.padding.bottom, viewport));
    target.paddingLeft = numericPx(resolveLengthToPx(layout.padding.left, viewport));
  }
  if (layout.margin) {
    target.marginTop = numericPx(resolveLengthToPx(layout.margin.top, viewport));
    target.marginRight = numericPx(resolveLengthToPx(layout.margin.right, viewport));
    target.marginBottom = numericPx(resolveLengthToPx(layout.margin.bottom, viewport));
    target.marginLeft = numericPx(resolveLengthToPx(layout.margin.left, viewport));
  }
  if (layout.position === 'absolute' || layout.position === 'fixed') {
    target.position = 'absolute';
  } else if (layout.position) {
    target.position = 'relative';
  }
  if (layout.inset) {
    if (layout.inset.top) target.top = numericPx(resolveLengthToPx(layout.inset.top, viewport));
    if (layout.inset.right) {
      target.right = numericPx(resolveLengthToPx(layout.inset.right, viewport));
    }
    if (layout.inset.bottom) {
      target.bottom = numericPx(resolveLengthToPx(layout.inset.bottom, viewport));
    }
    if (layout.inset.left) {
      target.left = numericPx(resolveLengthToPx(layout.inset.left, viewport));
    }
  }
  if (layout.zIndex !== undefined) target.zIndex = layout.zIndex;
  if (layout.overflow === 'hidden' || layout.overflow === 'visible') {
    target.overflow = layout.overflow;
  } else if (layout.overflow === 'auto' || layout.overflow === 'scroll') {
    target.overflow = 'scroll';
  }
  if (layout.alignSelf) {
    target.alignSelf =
      layout.alignSelf === 'start'
        ? 'flex-start'
        : layout.alignSelf === 'end'
          ? 'flex-end'
          : layout.alignSelf;
  }
  if (layout.flexGrow !== undefined) target.flexGrow = layout.flexGrow;
  if (layout.flexShrink !== undefined) target.flexShrink = layout.flexShrink;
  if (layout.aspectRatio !== undefined) target.aspectRatio = layout.aspectRatio;
}

function applyNativeTypography(
  typography: TypographyStyle,
  context: RenderContext,
  target: ReactNativeStyleSheet,
): void {
  const { theme } = context;
  if (typography.fontFamily) {
    target.fontFamily = theme.palette.fontFamilies[typography.fontFamily];
  }
  if (typography.size !== undefined) {
    target.fontSize = typography.size;
  }
  if (typography.lineHeight !== undefined) {
    target.lineHeight =
      typography.lineHeight <= 4
        ? Math.round((target.fontSize ?? 14) * typography.lineHeight)
        : typography.lineHeight;
  }
  if (typography.weight !== undefined) {
    const w = typography.weight;
    target.fontWeight = w >= 700 ? '700' : w >= 600 ? '600' : w >= 500 ? '500' : '400';
  }
  if (typography.letterSpacing !== undefined) {
    target.letterSpacing = Number((typography.letterSpacing * (target.fontSize ?? 14)).toFixed(2));
  }
  if (typography.align) target.textAlign = typography.align;
  if (typography.uppercase) target.textTransform = 'uppercase';
  if (typography.color) target.color = resolveColorToCss(typography.color, theme, false);
}

/**
 * Pluggable OOP React Native renderer compiling any `UiNode` scene graph into
 * Expo / React Native style descriptors, blur views, and Skia/Metal shader surfaces.
 */
export class ReactNativeRenderer implements UiRenderer<ReactNativeElementDescriptor> {
  readonly target = 'react-native' as const;

  render(node: UiNode, context: RenderContext): ReactNativeElementDescriptor {
    const resolved = resolveStyleForViewport(
      node.style,
      context.viewport.width,
      context.theme.palette.breakpoints,
    );
    const material = normalizeMaterialIR(resolved.material);
    const component = mapPrimitiveType(node.kind, material, Boolean(node.events.onPress));
    const style: ReactNativeStyleSheet = {};

    if (resolved.layout) applyNativeLayout(resolved.layout, context, style);
    if (resolved.typography) applyNativeTypography(resolved.typography, context, style);

    if (resolved.corners) {
      style.borderTopLeftRadius = resolved.corners.topLeft;
      style.borderTopRightRadius = resolved.corners.topRight;
      style.borderBottomRightRadius = resolved.corners.bottomRight;
      style.borderBottomLeftRadius = resolved.corners.bottomLeft;
      style.borderCurve = resolved.corners.shape === 'superellipse' ? 'continuous' : 'circular';
    }
    if (resolved.border && resolved.border.style !== 'none' && resolved.border.width > 0) {
      style.borderWidth = resolved.border.width;
      style.borderColor = resolveColorToCss(resolved.border.color, context.theme, false);
    }
    if (resolved.shadows && resolved.shadows.length > 0) {
      const primary = resolved.shadows.find((s) => !s.inset) ?? resolved.shadows[0];
      if (primary) {
        const [r, g, b, a] = resolveColorToSrgb(primary.color, context.theme);
        style.shadowColor = `rgb(${r}, ${g}, ${b})`;
        style.shadowOffset = { width: primary.offsetX, height: primary.offsetY };
        style.shadowOpacity = Number(a.toFixed(3));
        style.shadowRadius = primary.blurRadius;
        style.elevation = Math.max(1, Math.round(primary.blurRadius / 3));
      }
    }
    if (resolved.opacity !== undefined) style.opacity = resolved.opacity;

    let backdropEffect: BackdropEffect | undefined;
    let shaderPass: ShaderPassDescriptor | undefined;
    let rimLight: RimLightingPass | undefined;

    if (material) {
      switch (material.kind) {
        case 'solid':
          style.backgroundColor = resolveColorToCss(material.color, context.theme, false);
          break;
        case 'gradient':
          if (material.stops[0]) {
            style.backgroundColor = resolveColorToCss(
              material.stops[0].color,
              context.theme,
              false,
            );
          }
          break;
        case 'blur':
          if (material.tint) {
            style.backgroundColor = resolveColorToCss(material.tint, context.theme, false);
          }
          backdropEffect = {
            blurRadius: material.blur.radius,
            tintColor: material.tint ?? context.theme.color('materialTop'),
          };
          break;
        case 'backdrop':
          style.backgroundColor = resolveColorToCss(
            material.backdrop.tintColor ?? material.fallbackColor,
            context.theme,
            false,
          );
          backdropEffect = material.backdrop;
          rimLight = material.rimLighting;
          break;
        case 'shader':
          style.backgroundColor = resolveColorToCss(
            material.backdrop?.tintColor ?? material.fallbackColor,
            context.theme,
            false,
          );
          backdropEffect = material.backdrop;
          shaderPass = material.passes[0];
          rimLight = material.rimLighting;
          break;
      }
    }

    const childNodes: (ReactNativeElementDescriptor | string)[] = [];
    if (node.props.text !== undefined) {
      childNodes.push(node.props.text);
    }
    for (const child of node.children) {
      childNodes.push(this.render(child, context));
    }

    return {
      component,
      kind: node.kind,
      ...(node.id ? { id: node.id } : {}),
      style,
      props: {
        ...(node.props.testId ? { testID: node.props.testId } : {}),
        ...(node.props.ariaLabel ? { accessibilityLabel: node.props.ariaLabel } : {}),
        ...(node.props.disabled ? { disabled: true } : {}),
        ...(node.props.src ? { source: { uri: node.props.src } } : {}),
      },
      events: node.events,
      ...(backdropEffect ? { backdropEffect } : {}),
      ...(shaderPass ? { shaderPass } : {}),
      ...(rimLight ? { rimLight } : {}),
      children: childNodes,
    };
  }
}
