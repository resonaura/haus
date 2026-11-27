/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  clampLength,
  colorToken,
  corners,
  insets,
  pct,
  px,
  vw,
  type SemanticColorToken,
  type ViewportMetrics,
} from '../ir/geometry.js';
import {
  BackdropMaterial,
  LiquidGlassMaterial,
  ShaderMaterial,
  SolidMaterial,
  type ShaderPassDescriptor,
} from '../ir/materials.js';
import {
  mergeStyleSpecs,
  UiNode,
  type UiComponent,
  type UiStyleSpec,
  type UiTheme,
} from '../ir/node.js';

export interface SurfaceBlueprintProps {
  readonly id?: string;
  readonly elevation?: 'sunken' | 'default' | 'elevated' | 'overlay';
  readonly paddingPx?: number;
  readonly radiusPx?: number;
  readonly style?: UiStyleSpec;
  readonly children?: readonly UiNode[];
}

export class SurfaceBlueprint implements UiComponent<SurfaceBlueprintProps> {
  readonly name = 'HausSurface';

  build(props: SurfaceBlueprintProps, theme: UiTheme): UiNode {
    const tokenMap: Record<NonNullable<SurfaceBlueprintProps['elevation']>, SemanticColorToken> = {
      sunken: 'soft',
      default: 'surface',
      elevated: 'surfaceElevated',
      overlay: 'surfaceHover',
    };
    const token = tokenMap[props.elevation ?? 'default'];
    return new UiNode({
      kind: 'surface',
      id: props.id,
      style: mergeStyleSpecs(
        {
          layout: {
            display: 'flex',
            direction: 'column',
            padding: insets(props.paddingPx ?? 16),
          },
          material: new SolidMaterial(theme.color(token)),
          corners: corners(props.radiusPx ?? theme.palette.radii.card, 'superellipse', 1.4),
          border: {
            width: 1,
            style: 'solid',
            color: colorToken('border'),
          },
        },
        props.style,
      ),
      children: props.children,
    });
  }
}

export interface GlassSurfaceBlueprintProps {
  readonly id?: string;
  readonly variant?: 'frosted' | 'liquid-glass' | 'custom-shader';
  readonly blurPx?: number;
  readonly refractionStrength?: number;
  readonly chromaticDispersion?: number;
  readonly saturation?: number;
  readonly tintOpacity?: number;
  readonly customShader?: ShaderPassDescriptor;
  readonly paddingPx?: number;
  readonly radiusPx?: number;
  readonly style?: UiStyleSpec;
  readonly children?: readonly UiNode[];
}

export class GlassSurfaceBlueprint implements UiComponent<GlassSurfaceBlueprintProps> {
  readonly name = 'HausGlassSurface';

  build(props: GlassSurfaceBlueprintProps, theme: UiTheme): UiNode {
    const variant = props.variant ?? 'liquid-glass';
    const blurRadius = props.blurPx ?? theme.palette.blur.glass;
    const tint = theme.color('materialTop');

    const material =
      variant === 'custom-shader' && props.customShader
        ? new ShaderMaterial([props.customShader], {
            fallbackColor: tint,
            backdrop: {
              blurRadius,
              saturation: props.saturation ?? 1.45,
              brightness: 1.04,
              contrast: 1.03,
              tintColor: tint,
            },
          })
        : variant === 'frosted'
          ? new BackdropMaterial(
              {
                blurRadius,
                saturation: props.saturation ?? 1.35,
                brightness: 1.02,
                contrast: 1.02,
                tintColor: tint,
              },
              {
                fallbackColor: tint,
                rimLighting: {
                  preset: 'card',
                  specularIntensity: 0.72,
                  diffuseDepth: 6,
                  edgeDarkening: 0.06,
                  cornerExponent: 1.4,
                },
              },
            )
          : new LiquidGlassMaterial({
              tintColor: tint,
              blurRadius,
              refractionStrength: props.refractionStrength ?? 16,
              chromaticDispersion: props.chromaticDispersion ?? 0.65,
              saturation: props.saturation ?? 1.38,
              tintOpacity: props.tintOpacity ?? 0.24,
              rimPreset: 'card',
              cornerExponent: 1.4,
            });

    return new UiNode({
      kind: 'surface',
      id: props.id,
      style: mergeStyleSpecs(
        {
          layout: {
            display: 'flex',
            direction: 'column',
            padding: insets(props.paddingPx ?? 16),
          },
          material,
          corners: corners(props.radiusPx ?? theme.palette.radii.card, 'superellipse', 1.4),
          border: {
            width: 1,
            style: 'solid',
            color: colorToken('materialEdge'),
          },
          shadows: [
            {
              offsetX: 0,
              offsetY: 16,
              blurRadius: 36,
              spreadRadius: -14,
              color: colorToken('shadow'),
            },
          ],
        },
        props.style,
      ),
      children: props.children,
    });
  }
}

export interface ButtonBlueprintProps {
  readonly id?: string;
  readonly label?: string;
  readonly variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'glass';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly disabled?: boolean;
  readonly onPress?: () => void;
  readonly style?: UiStyleSpec;
  readonly children?: readonly UiNode[];
}

export class ButtonBlueprint implements UiComponent<ButtonBlueprintProps> {
  readonly name = 'HausButton';

  build(props: ButtonBlueprintProps, theme: UiTheme): UiNode {
    const recipe = theme.recipe('button');
    const resolvedRecipe = recipe
      ? recipe.resolve({
          variant: props.variant ?? 'primary',
          size: props.size ?? 'md',
        })
      : {};

    return new UiNode({
      kind: 'button',
      id: props.id,
      props: {
        ...(props.label ? { text: props.label } : {}),
        disabled: props.disabled,
      },
      events: {
        onPress: props.onPress,
      },
      style: mergeStyleSpecs(
        resolvedRecipe,
        props.disabled ? { opacity: 0.48, cursor: 'not-allowed' } : { cursor: 'pointer' },
        props.style,
      ),
      children: props.children,
    });
  }
}

export interface BadgeBlueprintProps {
  readonly id?: string;
  readonly label: string;
  readonly tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  readonly style?: UiStyleSpec;
}

export class BadgeBlueprint implements UiComponent<BadgeBlueprintProps> {
  readonly name = 'HausBadge';

  build(props: BadgeBlueprintProps, theme: UiTheme): UiNode {
    const recipe = theme.recipe('badge');
    const resolved = recipe ? recipe.resolve({ tone: props.tone ?? 'default' }) : {};
    return new UiNode({
      kind: 'badge',
      id: props.id,
      props: { text: props.label },
      style: mergeStyleSpecs(resolved, props.style),
    });
  }
}

export interface SplitPaneBlueprintProps {
  readonly id?: string;
  readonly columns?: 1 | 2 | 3 | 'adaptive';
  readonly minColumnWidthPx?: number;
  readonly gapPx?: number;
  readonly style?: UiStyleSpec;
  readonly children: readonly UiNode[];
}

export class SplitPaneBlueprint implements UiComponent<SplitPaneBlueprintProps> {
  readonly name = 'HausSplitPane';

  build(props: SplitPaneBlueprintProps, _theme: UiTheme, viewport: ViewportMetrics): UiNode {
    const minCol = props.minColumnWidthPx ?? 340;
    let columnCount = 1;
    if (props.columns === 'adaptive' || props.columns === undefined) {
      if (viewport.width >= minCol * 3 + 96 && props.children.length >= 3) {
        columnCount = 3;
      } else if (viewport.width >= minCol * 2 + 48 && props.children.length >= 2) {
        columnCount = 2;
      }
    } else {
      columnCount = viewport.width < minCol * 1.5 ? 1 : props.columns;
    }

    return new UiNode({
      kind: 'split',
      id: props.id,
      style: mergeStyleSpecs(
        {
          layout: {
            display: 'grid',
            gridColumns: columnCount,
            gridMinColumnWidth: px(0),
            gap: px(props.gapPx ?? 14),
            width: pct(100),
          },
        },
        props.style,
      ),
      children: props.children,
    });
  }
}

export interface ModalBlueprintProps {
  readonly id?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl' | 'adaptive';
  readonly glass?: boolean;
  readonly richContentCount?: number;
  readonly style?: UiStyleSpec;
  readonly headerActions?: readonly UiNode[];
  readonly children?: readonly UiNode[];
  readonly footer?: readonly UiNode[];
}

export class ModalBlueprint implements UiComponent<ModalBlueprintProps> {
  readonly name = 'HausModal';

  build(props: ModalBlueprintProps, theme: UiTheme, _viewport: ViewportMetrics): UiNode {
    const recipe = theme.recipe('modal');
    const richCount = props.richContentCount ?? props.children?.length ?? 1;
    const sizeKey: 'sm' | 'md' | 'lg' | 'xl' | 'adaptive' =
      props.size ?? (richCount >= 2 ? 'adaptive' : 'md');

    const baseStyle = recipe
      ? recipe.resolve({
          size: sizeKey,
        })
      : {
          layout: {
            display: 'flex' as const,
            direction: 'column' as const,
            width: clampLength(px(560), vw(84), px(1140)),
            padding: insets(22),
            gap: px(16),
          },
        };

    const headerNode = new UiNode({
      kind: 'box',
      style: {
        layout: {
          display: 'flex',
          direction: 'row',
          alignItems: 'center',
          justifyContent: 'between',
          gap: px(12),
        },
      },
      children: [
        new UiNode({
          kind: 'stack',
          style: { layout: { display: 'flex', direction: 'column', gap: px(4) } },
          children: [
            new UiNode({
              kind: 'heading',
              props: { text: props.title, headingLevel: 2 },
              style: {
                typography: {
                  fontFamily: 'display',
                  size: 20,
                  weight: 700,
                  color: colorToken('textPrimary'),
                },
              },
            }),
            props.subtitle
              ? new UiNode({
                  kind: 'text',
                  props: { text: props.subtitle },
                  style: {
                    typography: {
                      fontFamily: 'sans',
                      size: 13,
                      color: colorToken('textMuted'),
                    },
                  },
                })
              : null,
          ],
        }),
        props.headerActions && props.headerActions.length > 0
          ? new UiNode({
              kind: 'box',
              style: {
                layout: {
                  display: 'flex',
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(8),
                },
              },
              children: props.headerActions,
            })
          : null,
      ],
    });

    return new UiNode({
      kind: 'modal',
      id: props.id,
      props: { role: 'dialog', ariaLabel: props.title },
      style: mergeStyleSpecs(baseStyle, props.style),
      children: [
        headerNode,
        ...(props.children ?? []),
        props.footer && props.footer.length > 0
          ? new UiNode({
              kind: 'box',
              style: {
                layout: {
                  display: 'flex',
                  direction: 'row',
                  alignItems: 'center',
                  justifyContent: 'end',
                  gap: px(10),
                },
              },
              children: props.footer,
            })
          : null,
      ],
    });
  }
}

export * from './domain-blueprints.js';
