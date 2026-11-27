/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { colorToken, corners, insets, pct, px, rgba } from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import {
  mergeStyleSpecs,
  UiNode,
  type UiComponent,
  type UiStyleSpec,
  type UiTheme,
} from '../ir/node.js';

export interface SwitchBlueprintProps {
  readonly id?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly label?: string;
  readonly description?: string;
  readonly ariaLabel?: string;
  readonly onChange?: (checked: boolean) => void;
  readonly style?: UiStyleSpec;
}

const SWITCH_DIMS = {
  sm: { width: 38, height: 20, thumbWidth: 18, thumbHeight: 14, pad: 3 },
  md: { width: 46, height: 24, thumbWidth: 22, thumbHeight: 18, pad: 3 },
  lg: { width: 54, height: 28, thumbWidth: 26, thumbHeight: 22, pad: 3 },
} as const;

export class SwitchBlueprint implements UiComponent<SwitchBlueprintProps> {
  readonly name = 'HausSwitch';

  build(props: SwitchBlueprintProps, theme: UiTheme): UiNode {
    const dim = SWITCH_DIMS[props.size ?? 'md'];
    const isDark = theme.mode === 'dark';
    const travel = dim.width - dim.thumbWidth - dim.pad * 2;
    const trackMaterial = props.checked
      ? new SolidMaterial(theme.color('accent'))
      : new SolidMaterial(isDark ? rgba(255, 255, 255, 0.16) : rgba(0, 0, 0, 0.12));

    const thumbNode = new UiNode({
      kind: 'box',
      style: {
        layout: {
          width: px(dim.thumbWidth),
          height: px(dim.thumbHeight),
          flexShrink: 0,
        },
        material: new SolidMaterial(
          props.checked ? theme.color('accentForeground') : rgba(255, 255, 255, isDark ? 0.92 : 0.98),
        ),
        corners: corners(999, 'round'),
        shadows: [
          {
            offsetX: 0,
            offsetY: 1,
            blurRadius: 2.5,
            color: rgba(0, 0, 0, 0.22),
          },
        ],
        transform: { translateX: props.checked ? travel : 0 },
        transitionMs: 190,
      },
    });

    return new UiNode({
      kind: 'switch',
      id: props.id,
      props: {
        role: 'switch',
        checked: props.checked,
        disabled: props.disabled,
        ariaLabel: props.ariaLabel ?? props.label,
      },
      events: {
        onPress: props.disabled ? undefined : () => props.onChange?.(!props.checked),
        onChange: props.disabled ? undefined : (value) => props.onChange?.(Boolean(value)),
      },
      style: mergeStyleSpecs(
        {
          layout: {
            display: 'inline-flex',
            direction: 'row',
            alignItems: 'center',
            width: px(dim.width),
            height: px(dim.height),
            padding: insets(dim.pad),
            flexShrink: 0,
          },
          material: trackMaterial,
          corners: corners(999, 'round'),
          border: { width: 0, style: 'none', color: rgba(0, 0, 0, 0) },
          opacity: props.disabled ? 0.45 : 1,
          cursor: props.disabled ? 'not-allowed' : 'pointer',
          transitionMs: 190,
        },
        props.style,
      ),
      children: [thumbNode],
    });
  }
}

export interface SliderBlueprintProps {
  readonly id?: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly valueLabel?: string;
  readonly minLabel?: string;
  readonly maxLabel?: string;
  readonly ariaLabel?: string;
  readonly onChange?: (value: number) => void;
  readonly style?: UiStyleSpec;
}

export class SliderBlueprint implements UiComponent<SliderBlueprintProps> {
  readonly name = 'HausSlider';

  build(props: SliderBlueprintProps, theme: UiTheme): UiNode {
    const min = props.min ?? 0;
    const max = props.max ?? 100;
    const span = Math.max(1e-9, max - min);
    const clamped = Math.max(min, Math.min(max, props.value));
    const ratioPct = ((clamped - min) / span) * 100;

    return new UiNode({
      kind: 'slider',
      id: props.id,
      props: {
        role: 'slider',
        value: clamped,
        min,
        max,
        step: props.step ?? 1,
        disabled: props.disabled,
        ariaLabel: props.ariaLabel ?? props.label,
      },
      events: {
        onChange: (next) => {
          if (typeof next === 'number' && Number.isFinite(next)) props.onChange?.(next);
        },
      },
      style: mergeStyleSpecs(
        {
          layout: {
            display: 'flex',
            direction: 'column',
            gap: px(6),
            width: pct(100),
          },
          opacity: props.disabled ? 0.45 : 1,
        },
        props.style,
      ),
      children: [
        props.label || props.valueLabel
          ? new UiNode({
              kind: 'box',
              style: {
                layout: {
                  display: 'flex',
                  direction: 'row',
                  alignItems: 'center',
                  justifyContent: 'between',
                  gap: px(8),
                },
              },
              children: [
                props.label
                  ? new UiNode({
                      kind: 'text',
                      props: { text: props.label },
                      style: {
                        typography: { size: 12.5, weight: 500, color: colorToken('textPrimary') },
                      },
                    })
                  : null,
                props.valueLabel
                  ? new UiNode({
                      kind: 'text',
                      props: { text: props.valueLabel },
                      style: {
                        typography: {
                          fontFamily: 'mono',
                          size: 11.5,
                          tabularNums: true,
                          color: colorToken('textMuted'),
                        },
                      },
                    })
                  : null,
              ],
            })
          : null,
        new UiNode({
          kind: 'box',
          style: {
            layout: {
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              width: pct(100),
              height: px(22),
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
                  width: pct(100),
                  height: px(22),
                  overflow: 'hidden',
                },
                material: new SolidMaterial(
                  theme.mode === 'dark' ? rgba(255, 255, 255, 0.11) : rgba(0, 0, 0, 0.09),
                ),
                corners: corners(999, 'round'),
              },
              children: [
                new UiNode({
                  kind: 'box',
                  style: {
                    layout: {
                      display: 'flex',
                      direction: 'row',
                      alignItems: 'center',
                      justifyContent: 'end',
                      width: px(28),
                      minWidth: px(28),
                      height: pct(100),
                      padding: insets(3),
                      flexGrow: ratioPct,
                      flexShrink: 0,
                    },
                    material: new SolidMaterial(theme.color('accent')),
                    corners: corners(999, 'round'),
                  },
                  children: [
                    new UiNode({
                      kind: 'box',
                      style: {
                        layout: { width: px(22), height: px(16), flexShrink: 0 },
                        material: new SolidMaterial(theme.color('accentForeground')),
                        corners: corners(999, 'round'),
                      },
                    }),
                  ],
                }),
                new UiNode({
                  kind: 'box',
                  style: {
                    layout: {
                      width: px(0),
                      height: pct(100),
                      flexGrow: Math.max(0, 100 - ratioPct),
                      flexShrink: 1,
                    },
                  },
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }
}

export interface SegmentedOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SegmentedControlBlueprintProps<T extends string = string> {
  readonly id?: string;
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly ariaLabel?: string;
  readonly onChange?: (value: T) => void;
  readonly style?: UiStyleSpec;
}

export class SegmentedControlBlueprint implements UiComponent<SegmentedControlBlueprintProps> {
  readonly name = 'HausSegmentedControl';

  build(props: SegmentedControlBlueprintProps, theme: UiTheme): UiNode {
    const isDark = theme.mode === 'dark';
    return new UiNode({
      kind: 'tabs',
      id: props.id,
      props: { role: 'radiogroup', ariaLabel: props.ariaLabel },
      style: mergeStyleSpecs(
        {
          layout: {
            display: 'inline-flex',
            direction: 'row',
            alignItems: 'center',
            gap: px(2),
            padding: insets(3),
          },
          material: new SolidMaterial(theme.color('controlFill')),
          corners: corners(999, 'round'),
          border: { width: 1, style: 'solid', color: colorToken('border') },
        },
        props.style,
      ),
      children: props.options.map((opt) => {
        const selected = opt.value === props.value;
        return new UiNode({
          kind: 'button',
          props: {
            text: opt.label,
            role: 'radio',
            selected,
            ariaPressed: selected,
            disabled: opt.disabled,
          },
          events: {
            onPress: opt.disabled ? undefined : () => props.onChange?.(opt.value),
          },
          style: {
            layout: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: insets(5, 12),
            },
            material: selected
              ? new SolidMaterial(isDark ? rgba(255, 255, 255, 0.16) : rgba(255, 255, 255, 0.96))
              : undefined,
            corners: corners(999, 'round'),
            typography: {
              size: 12.5,
              weight: selected ? 600 : 500,
              color: selected ? colorToken('textPrimary') : colorToken('textMuted'),
            },
            shadows: selected
              ? [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: rgba(0, 0, 0, 0.14) }]
              : undefined,
            cursor: opt.disabled ? 'not-allowed' : 'pointer',
            transitionMs: 160,
          },
        });
      }),
    });
  }
}

export interface TabsBlueprintItem {
  readonly key: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface TabsBlueprintProps {
  readonly id?: string;
  readonly items: readonly TabsBlueprintItem[];
  readonly selectedKey: string;
  readonly ariaLabel?: string;
  readonly onSelectionChange?: (key: string) => void;
  readonly style?: UiStyleSpec;
}

export class TabsBlueprint implements UiComponent<TabsBlueprintProps> {
  readonly name = 'HausTabs';

  build(props: TabsBlueprintProps, theme: UiTheme): UiNode {
    return new UiNode({
      kind: 'tabs',
      id: props.id,
      props: { role: 'tablist', ariaLabel: props.ariaLabel },
      style: mergeStyleSpecs(
        {
          layout: {
            display: 'flex',
            direction: 'row',
            alignItems: 'center',
            gap: px(4),
            padding: insets(4),
          },
          material: new SolidMaterial(theme.color('controlFill')),
          corners: corners(theme.palette.radii.control, 'superellipse', 1.4),
          border: { width: 1, style: 'solid', color: colorToken('border') },
        },
        props.style,
      ),
      children: props.items.map((item) => {
        const selected = item.key === props.selectedKey;
        return new UiNode({
          kind: 'button',
          props: {
            text: item.label,
            role: 'tab',
            selected,
            ariaPressed: selected,
            disabled: item.disabled,
          },
          events: {
            onPress: item.disabled ? undefined : () => props.onSelectionChange?.(item.key),
          },
          style: {
            layout: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: insets(6, 12),
              flexGrow: 1,
            },
            material: selected ? new SolidMaterial(theme.color('surfaceElevated')) : undefined,
            corners: corners(Math.max(8, theme.palette.radii.control - 2), 'superellipse', 1.4),
            typography: {
              size: 13,
              weight: selected ? 600 : 500,
              color: selected ? colorToken('textPrimary') : colorToken('textMuted'),
            },
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            transitionMs: 160,
          },
        });
      }),
    });
  }
}
