/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  colorToken,
  corners,
  insets,
  pct,
  px,
  rgba,
  type SemanticColorToken,
  type ViewportMetrics,
} from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import { UiNode, type UiComponent, type UiTheme } from '../ir/node.js';
import { BadgeBlueprint, ButtonBlueprint, GlassSurfaceBlueprint } from './blueprints.js';

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
        : (props.installedVersion ?? props.latestVersion ?? 'Up to date');

    const statusBadge = this.badge.build(
      {
        label: props.inProgress
          ? 'Installing'
          : props.updateAvailable
            ? 'Update available'
            : 'Up to date',
        tone: props.inProgress ? 'accent' : props.updateAvailable ? 'warning' : 'success',
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
