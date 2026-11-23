/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type {
  CornerRadius,
  LayoutStyle,
  ShadowSpec,
  TypographyStyle,
} from '../ir/geometry.js';
import type {
  BackdropEffect,
  MaterialIR,
  RimLightingPass,
  ShaderRegistry,
} from '../ir/materials.js';
import {
  normalizeMaterialIR,
  resolveStyleForViewport,
  type UiNode,
  type UiNodeKind,
  type UiStyleSpec,
  type UiTheme,
} from '../ir/node.js';
import {
  resolveColorToCss,
  resolveColorToSrgb,
  resolveLengthToCss,
  type RenderContext,
  type UiRenderer,
} from './contract.js';

function tagForNodeKind(kind: UiNodeKind, headingLevel?: 1 | 2 | 3 | 4): string {
  switch (kind) {
    case 'button':
      return 'button';
    case 'text':
    case 'badge':
      return 'span';
    case 'heading':
      return `h${headingLevel ?? 3}`;
    case 'image':
      return 'img';
    case 'input':
      return 'input';
    case 'select':
      return 'select';
    case 'divider':
      return 'hr';
    case 'modal':
      return 'section';
    default:
      return 'div';
  }
}

function buildBackdropFilterCss(effect: BackdropEffect): string {
  const parts: string[] = [`blur(${effect.blurRadius}px)`];
  if (effect.saturation !== undefined && effect.saturation !== 1) {
    parts.push(`saturate(${Math.round(effect.saturation * 100)}%)`);
  }
  if (effect.brightness !== undefined && effect.brightness !== 1) {
    parts.push(`brightness(${Math.round(effect.brightness * 100)}%)`);
  }
  if (effect.contrast !== undefined && effect.contrast !== 1) {
    parts.push(`contrast(${Math.round(effect.contrast * 100)}%)`);
  }
  return parts.join(' ');
}

function buildRimLightShadow(rim: RimLightingPass, theme: UiTheme): string {
  const [r, g, b, a] = resolveColorToSrgb(theme.color('materialRim'), theme);
  const effectiveAlpha = Number(Math.max(0, Math.min(1, a * rim.specularIntensity)).toFixed(3));
  return `inset 0px 1px ${Math.max(1, rim.diffuseDepth)}px 0px rgba(${r}, ${g}, ${b}, ${effectiveAlpha})`;
}

function applyLayoutCss(layout: LayoutStyle, target: React.CSSProperties): void {
  if (layout.display) target.display = layout.display;
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
  if (layout.gap) target.gap = resolveLengthToCss(layout.gap);
  if (layout.rowGap) target.rowGap = resolveLengthToCss(layout.rowGap);
  if (layout.columnGap) target.columnGap = resolveLengthToCss(layout.columnGap);
  if (layout.gridColumns !== undefined) {
    target.display = 'grid';
    if (typeof layout.gridColumns === 'number') {
      const minTrack = layout.gridMinColumnWidth
        ? resolveLengthToCss(layout.gridMinColumnWidth)
        : '0px';
      target.gridTemplateColumns = `repeat(${layout.gridColumns}, minmax(${minTrack}, 1fr))`;
    } else {
      target.gridTemplateColumns = layout.gridColumns
        .map((c) => resolveLengthToCss(c))
        .join(' ');
    }
  }
  if (layout.width) target.width = resolveLengthToCss(layout.width);
  if (layout.minWidth) target.minWidth = resolveLengthToCss(layout.minWidth);
  if (layout.maxWidth) target.maxWidth = resolveLengthToCss(layout.maxWidth);
  if (layout.height) target.height = resolveLengthToCss(layout.height);
  if (layout.minHeight) target.minHeight = resolveLengthToCss(layout.minHeight);
  if (layout.maxHeight) target.maxHeight = resolveLengthToCss(layout.maxHeight);
  if (layout.padding) {
    if (layout.padding.top) target.paddingTop = resolveLengthToCss(layout.padding.top);
    if (layout.padding.right) target.paddingRight = resolveLengthToCss(layout.padding.right);
    if (layout.padding.bottom) target.paddingBottom = resolveLengthToCss(layout.padding.bottom);
    if (layout.padding.left) target.paddingLeft = resolveLengthToCss(layout.padding.left);
  }
  if (layout.margin) {
    if (layout.margin.top) target.marginTop = resolveLengthToCss(layout.margin.top);
    if (layout.margin.right) target.marginRight = resolveLengthToCss(layout.margin.right);
    if (layout.margin.bottom) target.marginBottom = resolveLengthToCss(layout.margin.bottom);
    if (layout.margin.left) target.marginLeft = resolveLengthToCss(layout.margin.left);
  }
  if (layout.position) target.position = layout.position;
  if (layout.inset) {
    if (layout.inset.top) target.top = resolveLengthToCss(layout.inset.top);
    if (layout.inset.right) target.right = resolveLengthToCss(layout.inset.right);
    if (layout.inset.bottom) target.bottom = resolveLengthToCss(layout.inset.bottom);
    if (layout.inset.left) target.left = resolveLengthToCss(layout.inset.left);
  }
  if (layout.zIndex !== undefined) target.zIndex = layout.zIndex;
  if (layout.overflow) target.overflow = layout.overflow;
  if (layout.overflowX) target.overflowX = layout.overflowX;
  if (layout.overflowY) target.overflowY = layout.overflowY;
  if (layout.flexGrow !== undefined) target.flexGrow = layout.flexGrow;
  if (layout.flexShrink !== undefined) target.flexShrink = layout.flexShrink;
  if (layout.aspectRatio !== undefined) target.aspectRatio = String(layout.aspectRatio);
}

function applyTypographyCss(
  typography: TypographyStyle,
  theme: UiTheme,
  target: React.CSSProperties,
): void {
  if (typography.fontFamily) {
    target.fontFamily = theme.palette.fontFamilies[typography.fontFamily];
  }
  if (typography.size !== undefined) target.fontSize = `${typography.size}px`;
  if (typography.lineHeight !== undefined) target.lineHeight = typography.lineHeight;
  if (typography.weight !== undefined) target.fontWeight = typography.weight;
  if (typography.letterSpacing !== undefined) {
    target.letterSpacing = `${typography.letterSpacing}em`;
  }
  if (typography.align) target.textAlign = typography.align;
  if (typography.uppercase) target.textTransform = 'uppercase';
  if (typography.color) target.color = resolveColorToCss(typography.color, theme);
  if (typography.whiteSpace) target.whiteSpace = typography.whiteSpace;
  if (typography.truncate) {
    target.whiteSpace = 'nowrap';
    target.overflow = 'hidden';
    target.textOverflow = 'ellipsis';
  }
  if (typography.tabularNums) {
    target.fontVariantNumeric = 'tabular-nums';
  }
}

function applyCornersCss(
  corners: CornerRadius,
  target: React.CSSProperties & Record<string, string | number | undefined>,
): void {
  target.borderTopLeftRadius = `${corners.topLeft}px`;
  target.borderTopRightRadius = `${corners.topRight}px`;
  target.borderBottomRightRadius = `${corners.bottomRight}px`;
  target.borderBottomLeftRadius = `${corners.bottomLeft}px`;
  if (corners.shape === 'superellipse') {
    target['--haus-corner-exponent'] = String(corners.exponent ?? 1.4);
  }
}

function formatShadowList(shadows: readonly ShadowSpec[], theme: UiTheme): string {
  return shadows
    .map((s) => {
      const prefix = s.inset ? 'inset ' : '';
      return `${prefix}${s.offsetX}px ${s.offsetY}px ${s.blurRadius}px ${s.spreadRadius ?? 0}px ${resolveColorToCss(s.color, theme)}`;
    })
    .join(', ');
}

function applyMaterialCss(
  material: MaterialIR,
  context: RenderContext,
  extraShadows: string[],
  target: React.CSSProperties & Record<string, string | number | undefined>,
): { readonly shaderId?: string } {
  const { theme, viewport } = context;
  switch (material.kind) {
    case 'solid':
      target.backgroundColor = resolveColorToCss(material.color, theme);
      if (material.blur) {
        target.filter = `blur(${material.blur.radius}px)`;
      }
      return {};
    case 'gradient': {
      const stops = material.stops
        .map((s) => `${resolveColorToCss(s.color, theme)} ${Math.round(s.offset * 100)}%`)
        .join(', ');
      target.backgroundImage =
        material.gradientType === 'radial'
          ? `radial-gradient(circle at center, ${stops})`
          : `linear-gradient(${material.angleDeg}deg, ${stops})`;
      return {};
    }
    case 'blur':
      if (material.tint) {
        target.backgroundColor = resolveColorToCss(material.tint, theme);
      }
      target.filter = `blur(${material.blur.radius}px)`;
      return {};
    case 'backdrop': {
      const tintColor = material.backdrop.tintColor ?? material.fallbackColor;
      const [r, g, b, a] = resolveColorToSrgb(tintColor, theme);
      if (viewport.reducedTransparency) {
        target.backgroundColor = `rgba(${r}, ${g}, ${b}, ${Math.max(a, 0.94)})`;
      } else {
        target.backgroundColor = resolveColorToCss(tintColor, theme);
        const bf = buildBackdropFilterCss(material.backdrop);
        target.backdropFilter = bf;
        target.WebkitBackdropFilter = bf;
      }
      if (material.rimLighting) {
        extraShadows.push(buildRimLightShadow(material.rimLighting, theme));
      }
      return {};
    }
    case 'shader': {
      const primaryPass = material.passes[0];
      const tintColor = material.backdrop?.tintColor ?? material.fallbackColor;
      const [r, g, b, a] = resolveColorToSrgb(tintColor, theme);
      if (viewport.reducedTransparency) {
        target.backgroundColor = `rgba(${r}, ${g}, ${b}, ${Math.max(a, 0.95)})`;
        return { ...(primaryPass ? { shaderId: primaryPass.id } : {}) };
      }
      target.backgroundColor = resolveColorToCss(tintColor, theme);
      if (material.backdrop) {
        const bf = buildBackdropFilterCss(material.backdrop);
        target.backdropFilter = bf;
        target.WebkitBackdropFilter = bf;
      }
      if (material.rimLighting) {
        extraShadows.push(buildRimLightShadow(material.rimLighting, theme));
      }
      if (primaryPass) {
        for (const [uKey, uVal] of Object.entries(primaryPass.uniforms)) {
          if (uVal.type === 'f32') {
            target[`--haus-u-${uKey}`] = String(uVal.value);
          }
        }
      }
      return { ...(primaryPass ? { shaderId: primaryPass.id } : {}) };
    }
  }
}

/** Converts a `UiStyleSpec` into a concrete `React.CSSProperties` map for a given `RenderContext`. */
export function compileStyleToReactCss(
  rawStyle: UiStyleSpec,
  context: RenderContext,
): {
  readonly style: React.CSSProperties;
  readonly shaderId?: string;
} {
  const resolved = resolveStyleForViewport(
    rawStyle,
    context.viewport.width,
    context.theme.palette.breakpoints,
  );
  const css: React.CSSProperties & Record<string, string | number | undefined> = {};
  const shadowParts: string[] = [];

  if (resolved.layout) applyLayoutCss(resolved.layout, css);
  if (resolved.typography) applyTypographyCss(resolved.typography, context.theme, css);
  if (resolved.corners) applyCornersCss(resolved.corners, css);
  if (resolved.border && resolved.border.style !== 'none' && resolved.border.width > 0) {
    css.border = `${resolved.border.width}px ${resolved.border.style ?? 'solid'} ${resolveColorToCss(resolved.border.color, context.theme)}`;
  }
  if (resolved.shadows && resolved.shadows.length > 0) {
    shadowParts.push(formatShadowList(resolved.shadows, context.theme));
  }

  let shaderId: string | undefined;
  const materialIR = normalizeMaterialIR(resolved.material);
  if (materialIR) {
    const res = applyMaterialCss(materialIR, context, shadowParts, css);
    shaderId = res.shaderId;
  }

  if (shadowParts.length > 0) {
    css.boxShadow = shadowParts.join(', ');
  }
  if (resolved.transform) {
    const tParts: string[] = [];
    if (resolved.transform.translateX || resolved.transform.translateY) {
      tParts.push(
        `translate3d(${resolved.transform.translateX ?? 0}px, ${resolved.transform.translateY ?? 0}px, 0)`,
      );
    }
    if (resolved.transform.scale !== undefined && resolved.transform.scale !== 1) {
      tParts.push(`scale(${resolved.transform.scale})`);
    }
    if (resolved.transform.rotateDeg) {
      tParts.push(`rotate(${resolved.transform.rotateDeg}deg)`);
    }
    if (tParts.length > 0) css.transform = tParts.join(' ');
  }
  if (resolved.opacity !== undefined) css.opacity = resolved.opacity;
  if (resolved.cursor) css.cursor = resolved.cursor;
  if (resolved.pointerEvents) css.pointerEvents = resolved.pointerEvents;
  if (resolved.selectNone) css.userSelect = 'none';
  if (resolved.transitionMs && !context.viewport.reducedMotion) {
    css.transition = `all ${resolved.transitionMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  }

  return { style: css, ...(shaderId ? { shaderId } : {}) };
}

/**
 * Renders procedural SVG refraction/dispersion filter definitions registered in `ShaderRegistry`
 * so `LiquidGlassMaterial` and custom shaders can apply hardware-accelerated backdrop refraction.
 */
export function renderSvgShaderDefs(shaderRegistry: ShaderRegistry): React.ReactElement | null {
  const shadersWithSvg = shaderRegistry
    .list()
    .filter((s) => Boolean(s.targets.svgFilter));
  if (shadersWithSvg.length === 0) return null;

  return React.createElement(
    'svg',
    {
      'aria-hidden': 'true',
      style: {
        position: 'absolute',
        width: 0,
        height: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      },
    },
    React.createElement(
      'defs',
      null,
      shadersWithSvg.map((shader) => {
        const scale = shader.targets.svgFilter?.refractionStrength ?? 12;
        return React.createElement(
          'filter',
          {
            key: shader.id,
            id: `svg-${shader.id}`,
            x: '-10%',
            y: '-10%',
            width: '120%',
            height: '120%',
            colorInterpolationFilters: 'sRGB',
          },
          React.createElement('feTurbulence', {
            type: 'fractalNoise',
            baseFrequency: '0.015 0.02',
            numOctaves: 2,
            seed: 7,
            result: 'noise',
          }),
          React.createElement('feDisplacementMap', {
            in: 'SourceGraphic',
            in2: 'noise',
            scale,
            xChannelSelector: 'R',
            yChannelSelector: 'G',
          }),
        );
      }),
    ),
  );
}

/**
 * Pluggable OOP React DOM renderer converting any `UiNode` scene graph into React elements.
 */
export class ReactDomRenderer implements UiRenderer<React.ReactElement> {
  readonly target = 'react-dom' as const;

  render(node: UiNode, context: RenderContext): React.ReactElement {
    const tag = tagForNodeKind(node.kind, node.props.headingLevel);
    const { style, shaderId } = compileStyleToReactCss(node.style, context);

    const domProps: Record<string, unknown> = {
      style,
      'data-haus-kind': node.kind,
    };

    if (node.id) domProps.id = node.id;
    if (node.props.className) domProps.className = node.props.className;
    if (node.props.role) domProps.role = node.props.role;
    if (node.props.ariaLabel) domProps['aria-label'] = node.props.ariaLabel;
    if (node.props.ariaPressed !== undefined) domProps['aria-pressed'] = node.props.ariaPressed;
    if (node.props.testId) domProps['data-testid'] = node.props.testId;
    if (shaderId) domProps['data-haus-shader'] = shaderId;

    if (node.kind === 'button') {
      domProps.type = 'button';
      if (node.props.disabled) domProps.disabled = true;
    }
    if (node.kind === 'image') {
      domProps.src = node.props.src;
      domProps.alt = node.props.alt ?? '';
      return React.createElement(tag, domProps);
    }
    if (node.kind === 'divider') {
      return React.createElement(tag, domProps);
    }
    if (node.kind === 'input') {
      domProps.value = node.props.value ?? '';
      domProps.placeholder = node.props.placeholder;
      domProps.disabled = node.props.disabled;
      if (node.events.onInput) {
        domProps.onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          node.events.onInput?.(e.target.value);
        };
      }
      return React.createElement(tag, domProps);
    }
    if (node.kind === 'select') {
      domProps.value = node.props.value ?? '';
      domProps.disabled = node.props.disabled;
      if (node.events.onChange) {
        domProps.onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
          node.events.onChange?.(e.target.value);
        };
      }
      const optionElements = (node.props.options ?? []).map((opt) =>
        React.createElement('option', { key: opt.value, value: opt.value }, opt.label),
      );
      return React.createElement(tag, domProps, ...optionElements);
    }

    if (node.events.onPress && !node.props.disabled) {
      domProps.onClick = () => {
        node.events.onPress?.();
      };
    }

    const childElements: React.ReactNode[] = [];
    if (node.props.text !== undefined) {
      childElements.push(node.props.text);
    }
    node.children.forEach((child, idx) => {
      const rendered = this.render(child, context);
      childElements.push(
        React.cloneElement(rendered, { key: child.id ?? `${child.kind}-${idx}` }),
      );
    });

    return React.createElement(tag, domProps, ...childElements);
  }
}
