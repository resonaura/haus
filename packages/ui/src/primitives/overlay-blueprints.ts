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
  type ViewportMetrics,
} from '../ir/geometry.js';
import { BackdropMaterial, LiquidGlassMaterial, SolidMaterial } from '../ir/materials.js';
import {
  mergeStyleSpecs,
  UiNode,
  type UiComponent,
  type UiStyleSpec,
  type UiTheme,
} from '../ir/node.js';

export interface TextFieldBlueprintProps {
  readonly id?: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly label?: string;
  readonly description?: string;
  readonly error?: string;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly onInput?: (value: string) => void;
  readonly style?: UiStyleSpec;
}

export class TextFieldBlueprint implements UiComponent<TextFieldBlueprintProps> {
  readonly name = 'HausTextField';

  build(props: TextFieldBlueprintProps, theme: UiTheme): UiNode {
    return new UiNode({
      kind: 'input',
      id: props.id,
      props: {
        value: props.value,
        placeholder: props.placeholder,
        disabled: props.disabled,
        ariaLabel: props.ariaLabel ?? props.label,
      },
      events: { onInput: props.onInput },
      style: mergeStyleSpecs(
        {
          layout: { width: pct(100), padding: insets(9, 12) },
          material: new SolidMaterial(theme.color('soft')),
          corners: corners(theme.palette.radii.field, 'superellipse', 1.4),
          border: {
            width: 1,
            style: 'solid',
            color: props.error ? colorToken('critical') : colorToken('border'),
          },
          typography: { size: 13.5, color: colorToken('textPrimary') },
          opacity: props.disabled ? 0.5 : 1,
        },
        props.style,
      ),
    });
  }
}

export interface SelectBlueprintOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectBlueprintProps {
  readonly id?: string;
  readonly value: string;
  readonly options: readonly SelectBlueprintOption[];
  readonly label?: string;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly onChange?: (value: string) => void;
  readonly style?: UiStyleSpec;
}

export class SelectBlueprint implements UiComponent<SelectBlueprintProps> {
  readonly name = 'HausSelect';

  build(props: SelectBlueprintProps, theme: UiTheme): UiNode {
    return new UiNode({
      kind: 'select',
      id: props.id,
      props: {
        value: props.value,
        options: props.options,
        disabled: props.disabled,
        ariaLabel: props.ariaLabel ?? props.label,
      },
      events: {
        onChange: (next) => {
          if (typeof next === 'string') props.onChange?.(next);
        },
      },
      style: mergeStyleSpecs(
        {
          layout: { padding: insets(7, 11) },
          material: new SolidMaterial(theme.color('soft')),
          corners: corners(theme.palette.radii.field, 'superellipse', 1.4),
          border: { width: 1, style: 'solid', color: colorToken('border') },
          typography: { size: 12.5, color: colorToken('textPrimary') },
          opacity: props.disabled ? 0.5 : 1,
          cursor: props.disabled ? 'not-allowed' : 'pointer',
        },
        props.style,
      ),
    });
  }
}

export interface ScrollAreaBlueprintProps {
  readonly id?: string;
  readonly orientation?: 'vertical' | 'horizontal' | 'both';
  readonly hideScrollBar?: boolean;
  readonly shadowSizePx?: number;
  readonly style?: UiStyleSpec;
  readonly children?: readonly UiNode[];
}

export class ScrollAreaBlueprint implements UiComponent<ScrollAreaBlueprintProps> {
  readonly name = 'HausScrollArea';

  build(props: ScrollAreaBlueprintProps): UiNode {
    const orientation = props.orientation ?? 'vertical';
    return new UiNode({
      kind: 'scroll',
      id: props.id,
      props: {
        meta: {
          orientation,
          hideScrollBar: Boolean(props.hideScrollBar),
          shadowSizePx: props.shadowSizePx ?? 24,
        },
      },
      style: mergeStyleSpecs(
        {
          layout: {
            overflowX: orientation === 'vertical' ? 'hidden' : 'auto',
            overflowY: orientation === 'horizontal' ? 'hidden' : 'auto',
          },
        },
        props.style,
      ),
      children: props.children,
    });
  }
}

export interface DividerBlueprintProps {
  readonly id?: string;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly style?: UiStyleSpec;
}

export class DividerBlueprint implements UiComponent<DividerBlueprintProps> {
  readonly name = 'HausDivider';

  build(props: DividerBlueprintProps): UiNode {
    const vertical = props.orientation === 'vertical';
    return new UiNode({
      kind: 'divider',
      id: props.id,
      style: mergeStyleSpecs(
        {
          layout: vertical
            ? { width: px(1), height: pct(100) }
            : { width: pct(100), height: px(1) },
          material: new SolidMaterial(colorToken('border')),
        },
        props.style,
      ),
    });
  }
}

export interface DialogBlueprintProps {
  readonly id?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl' | 'adaptive';
  readonly backdrop?: 'blur' | 'liquid-glass' | 'dim';
  readonly style?: UiStyleSpec;
  readonly children?: readonly UiNode[];
}

export class DialogBlueprint implements UiComponent<DialogBlueprintProps> {
  readonly name = 'HausDialog';

  build(props: DialogBlueprintProps, theme: UiTheme, _viewport: ViewportMetrics): UiNode {
    const size = props.size ?? 'md';
    const widthSpec =
      size === 'sm'
        ? clampLength(px(360), vw(88), px(440))
        : size === 'lg'
          ? clampLength(px(520), vw(86), px(780))
          : size === 'xl'
            ? clampLength(px(640), vw(90), px(1080))
            : size === 'adaptive'
              ? clampLength(px(480), vw(86), px(1120))
              : clampLength(px(420), vw(88), px(520));

    const material =
      props.backdrop === 'liquid-glass'
        ? new LiquidGlassMaterial({
            tintColor: theme.color('surface'),
            blurRadius: theme.palette.blur.glass,
            refractionStrength: 14,
            saturation: 1.35,
            tintOpacity: 0.78,
            rimPreset: 'card',
          })
        : new BackdropMaterial(
            {
              blurRadius: theme.palette.blur.lg,
              saturation: 1.3,
              tintColor: theme.color('surface'),
            },
            { fallbackColor: theme.color('surface') },
          );

    return new UiNode({
      kind: 'modal',
      id: props.id,
      props: { role: 'dialog', ariaLabel: props.title },
      style: mergeStyleSpecs(
        {
          layout: {
            display: 'flex',
            direction: 'column',
            width: widthSpec,
            maxHeight: pct(90),
            padding: insets(24),
            gap: px(16),
          },
          material,
          corners: corners(theme.palette.radii.panel, 'superellipse', 1.4),
          border: { width: 1, style: 'solid', color: colorToken('materialEdge') },
          shadows: [
            {
              offsetX: 0,
              offsetY: 24,
              blurRadius: 64,
              spreadRadius: -16,
              color: rgba(0, 0, 0, theme.mode === 'dark' ? 0.62 : 0.24),
            },
          ],
        },
        props.style,
      ),
      children: props.children,
    });
  }
}
