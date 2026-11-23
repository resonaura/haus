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
  rgba,
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
              color: rgba(2, 6, 23, theme.mode === 'dark' ? 0.52 : 0.14),
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

export interface ProgressBarBlueprintProps {
  readonly id?: string;
  readonly value: number;
  readonly max?: number;
  readonly tone?: 'accent' | 'success' | 'warning' | 'critical';
  readonly label?: string;
}

export class ProgressBarBlueprint implements UiComponent<ProgressBarBlueprintProps> {
  readonly name = 'HausProgressBar';

  build(props: ProgressBarBlueprintProps): UiNode {
    const max = props.max ?? 100;
    const ratio = Math.max(0, Math.min(100, Math.round((props.value / Math.max(1, max)) * 100)));
    const toneColor: SemanticColorToken = props.tone ?? 'accent';

    return new UiNode({
      kind: 'progress',
      id: props.id,
      props: { progress: ratio, ariaLabel: props.label },
      style: {
        layout: {
          display: 'flex',
          direction: 'column',
          gap: px(6),
          width: pct(100),
        },
      },
      children: [
        props.label
          ? new UiNode({
              kind: 'box',
              style: {
                layout: {
                  display: 'flex',
                  direction: 'row',
                  justifyContent: 'between',
                  alignItems: 'center',
                },
              },
              children: [
                new UiNode({
                  kind: 'text',
                  props: { text: props.label },
                  style: { typography: { size: 12, color: colorToken('textMuted') } },
                }),
                new UiNode({
                  kind: 'text',
                  props: { text: `${ratio}%` },
                  style: {
                    typography: {
                      size: 12,
                      weight: 600,
                      tabularNums: true,
                      color: colorToken('textPrimary'),
                    },
                  },
                }),
              ],
            })
          : null,
        new UiNode({
          kind: 'box',
          style: {
            layout: {
              width: pct(100),
              height: px(8),
              overflow: 'hidden',
            },
            material: new SolidMaterial(colorToken('soft')),
            corners: corners(999, 'round'),
          },
          children: [
            new UiNode({
              kind: 'box',
              style: {
                layout: {
                  width: pct(ratio),
                  height: pct(100),
                },
                material: new SolidMaterial(colorToken(toneColor)),
                corners: corners(999, 'round'),
                transitionMs: 220,
              },
            }),
          ],
        }),
      ],
    });
  }
}

export interface UpdateCardBlueprintProps {
  readonly id?: string;
  readonly title: string;
  readonly installedVersion?: string | null;
  readonly latestVersion?: string | null;
  readonly updateAvailable: boolean;
  readonly inProgress?: boolean;
  readonly progressPercent?: number | null;
  readonly releaseSummary?: string | null;
  readonly releaseNotes?: string | null;
  readonly canInstall?: boolean;
  readonly canSkip?: boolean;
  readonly onInstall?: () => void;
  readonly onSkip?: () => void;
}

export class UpdateCardBlueprint implements UiComponent<UpdateCardBlueprintProps> {
  readonly name = 'HausUpdateCard';
  private readonly glass = new GlassSurfaceBlueprint();
  private readonly badge = new BadgeBlueprint();
  private readonly button = new ButtonBlueprint();
  private readonly progress = new ProgressBarBlueprint();

  build(props: UpdateCardBlueprintProps, theme: UiTheme, _viewport: ViewportMetrics): UiNode {
    const versionText =
      props.installedVersion &&
      props.latestVersion &&
      props.installedVersion !== props.latestVersion
        ? `${props.installedVersion} → ${props.latestVersion}`
        : props.installedVersion ?? props.latestVersion ?? 'Up to date';

    const statusBadge = this.badge.build(
      {
        label: props.inProgress
          ? 'Installing'
          : props.updateAvailable
            ? 'Update available'
            : 'Up to date',
        tone: props.inProgress
          ? 'accent'
          : props.updateAvailable
            ? 'warning'
            : 'success',
      },
      theme,
    );

    const children: UiNode[] = [
      new UiNode({
        kind: 'box',
        style: {
          layout: {
            display: 'flex',
            direction: 'row',
            alignItems: 'center',
            justifyContent: 'between',
            gap: px(10),
          },
        },
        children: [
          new UiNode({
            kind: 'stack',
            style: { layout: { display: 'flex', direction: 'column', gap: px(2) } },
            children: [
              new UiNode({
                kind: 'heading',
                props: { text: props.title, headingLevel: 4 },
                style: {
                  typography: {
                    size: 14,
                    weight: 600,
                    color: colorToken('textPrimary'),
                  },
                },
              }),
              new UiNode({
                kind: 'text',
                props: { text: versionText },
                style: {
                  typography: {
                    fontFamily: 'mono',
                    size: 12,
                    color: colorToken('textMuted'),
                  },
                },
              }),
            ],
          }),
          statusBadge,
        ],
      }),
    ];

    if (props.inProgress) {
      children.push(
        this.progress.build({
          value: props.progressPercent ?? 45,
          label: 'Firmware installation progress',
          tone: 'accent',
        }),
      );
    }

    const notesText = props.releaseNotes ?? props.releaseSummary;
    if (notesText) {
      children.push(
        new UiNode({
          kind: 'text',
          props: { text: notesText },
          style: {
            typography: {
              size: 12,
              lineHeight: 1.45,
              color: colorToken('textSecondary'),
            },
          },
        }),
      );
    }

    if (props.updateAvailable && !props.inProgress && (props.canInstall || props.canSkip)) {
      children.push(
        new UiNode({
          kind: 'box',
          style: {
            layout: {
              display: 'flex',
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'end',
              gap: px(8),
            },
          },
          children: [
            props.canSkip && props.onSkip
              ? this.button.build(
                  {
                    label: 'Skip version',
                    variant: 'ghost',
                    size: 'sm',
                    onPress: props.onSkip,
                  },
                  theme,
                )
              : null,
            props.canInstall && props.onInstall
              ? this.button.build(
                  {
                    label: 'Install firmware',
                    variant: 'primary',
                    size: 'sm',
                    onPress: props.onInstall,
                  },
                  theme,
                )
              : null,
          ],
        }),
      );
    }

    return this.glass.build(
      {
        id: props.id,
        variant: 'liquid-glass',
        paddingPx: 14,
        style: {
          layout: {
            display: 'flex',
            direction: 'column',
            gap: px(10),
          },
        },
        children,
      },
      theme,
    );
  }
}

export interface QrCardBlueprintProps {
  readonly id?: string;
  readonly title: string;
  readonly ssid?: string | null;
  readonly isGuest?: boolean;
  readonly imageDataUrl?: string | null;
  readonly loading?: boolean;
  readonly onRefresh?: () => void;
}

export class QrCardBlueprint implements UiComponent<QrCardBlueprintProps> {
  readonly name = 'HausQrCard';
  private readonly glass = new GlassSurfaceBlueprint();
  private readonly badge = new BadgeBlueprint();

  build(props: QrCardBlueprintProps, theme: UiTheme): UiNode {
    return this.glass.build(
      {
        id: props.id,
        variant: 'liquid-glass',
        paddingPx: 14,
        style: {
          layout: {
            display: 'flex',
            direction: 'column',
            alignItems: 'center',
            gap: px(10),
          },
        },
        children: [
          new UiNode({
            kind: 'box',
            style: {
              layout: {
                display: 'flex',
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'between',
                width: pct(100),
                gap: px(8),
              },
            },
            children: [
              new UiNode({
                kind: 'stack',
                style: { layout: { display: 'flex', direction: 'column', gap: px(2) } },
                children: [
                  new UiNode({
                    kind: 'heading',
                    props: { text: props.title, headingLevel: 4 },
                    style: {
                      typography: {
                        size: 13,
                        weight: 600,
                        color: colorToken('textPrimary'),
                      },
                    },
                  }),
                  props.ssid
                    ? new UiNode({
                        kind: 'text',
                        props: { text: `SSID: ${props.ssid}` },
                        style: {
                          typography: {
                            fontFamily: 'mono',
                            size: 11,
                            color: colorToken('textMuted'),
                          },
                        },
                      })
                    : null,
                ],
              }),
              this.badge.build(
                {
                  label: props.isGuest ? 'Guest Wi-Fi' : 'Primary Wi-Fi',
                  tone: props.isGuest ? 'accent' : 'success',
                },
                theme,
              ),
            ],
          }),
          props.imageDataUrl
            ? new UiNode({
                kind: 'box',
                style: {
                  layout: {
                    padding: insets(10),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  material: new SolidMaterial(rgba(255, 255, 255, 0.98)),
                  corners: corners(14, 'superellipse', 1.4),
                },
                children: [
                  new UiNode({
                    kind: 'image',
                    props: {
                      src: props.imageDataUrl,
                      alt: `${props.title} QR code`,
                    },
                    style: {
                      layout: {
                        width: px(156),
                        height: px(156),
                      },
                    },
                  }),
                ],
              })
            : new UiNode({
                kind: 'box',
                style: {
                  layout: {
                    width: px(156),
                    height: px(156),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  material: new SolidMaterial(colorToken('soft')),
                  corners: corners(14, 'superellipse', 1.4),
                },
                children: [
                  new UiNode({
                    kind: 'text',
                    props: {
                      text: props.loading ? 'Generating QR…' : 'QR unavailable',
                    },
                    style: {
                      typography: { size: 12, color: colorToken('textMuted') },
                    },
                  }),
                ],
              }),
        ],
      },
      theme,
    );
  }
}
