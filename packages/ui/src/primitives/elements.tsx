/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { colorToken, corners, insets, pct, px } from '../ir/geometry.js';
import { LiquidGlassMaterial, SolidMaterial } from '../ir/materials.js';
import type { UiStyleSpec } from '../ir/node.js';
import type {
  HostBlurEvent,
  HostBoxSemantic,
  HostDataAttrs,
  HostKeyEvent,
  HostPointerEvent,
  HostScrollEvent,
  HostSurfacePointerEvent,
  HostSurfaceTokens,
  HostTextSemantic,
  HostTouchEvent,
} from '../renderers/host.js';
import { composeStyles, resolveInteractiveStyle } from '../styles/sheet.js';
import { useHausUi } from './context.js';
export * from './media.js';

export interface BoxProps {
  readonly id?: string;
  readonly className?: string;
  readonly semantic?: HostBoxSemantic;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostSurfaceTokens;
  readonly paddingPx?: number;
  readonly gapPx?: number;
  readonly role?: string;
  readonly title?: string;
  readonly tabIndex?: number;
  readonly hidden?: boolean;
  readonly inert?: boolean;
  readonly disabled?: boolean;
  readonly draggable?: boolean;
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
  readonly ariaDescribedBy?: string;
  readonly ariaModal?: boolean;
  readonly ariaHidden?: boolean;
  readonly ariaBusy?: boolean;
  readonly ariaSelected?: boolean;
  readonly ariaExpanded?: boolean;
  readonly ariaLevel?: number;
  readonly ariaLive?: 'polite' | 'assertive' | 'off';
  readonly ariaSort?: 'none' | 'ascending' | 'descending' | 'other';
  readonly ariaKeyShortcuts?: string;
  readonly ariaValueMin?: number;
  readonly ariaValueMax?: number;
  readonly ariaValueNow?: number;
  readonly dataKind?: string;
  readonly dataAttrs?: HostDataAttrs;
  readonly boxRef?: React.Ref<unknown>;
  readonly onPress?: () => void;
  readonly stopPropagation?: boolean;
  readonly onBackdropPress?: () => void;
  readonly onPointerDown?: () => void;
  readonly onPointerDownEvent?: (event: HostSurfacePointerEvent) => void;
  readonly onPointerMoveEvent?: (event: HostSurfacePointerEvent) => void;
  readonly onPointerUpEvent?: (event: HostSurfacePointerEvent) => void;
  readonly onPointerCancel?: () => void;
  readonly onScroll?: (event: HostScrollEvent) => void;
  readonly onTouchStart?: (event: HostTouchEvent) => void;
  readonly onTouchMove?: () => void;
  readonly onPointerEnter?: () => void;
  readonly onPointerLeave?: () => void;
  readonly onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
  readonly onDragStart?: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDragOver?: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDragEnd?: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDrop?: (event: React.DragEvent<HTMLElement>) => void;
  readonly onPointerDownCapture?: (event: HostPointerEvent) => void;
  readonly onKeyDown?: (event: HostKeyEvent) => void;
  readonly onFocusCapture?: () => void;
  readonly onBlurCapture?: (event: HostBlurEvent) => void;
  readonly onDragStartCapture?: () => void;
  readonly onDragEndCapture?: () => void;
  readonly children?: React.ReactNode;
}

/** Universal container primitive styled purely through TypeScript `UiStyleSpec`. */
export function Box({
  paddingPx,
  gapPx,
  style,
  dataKind = 'box',
  ...rest
}: BoxProps): React.ReactElement {
  const ctx = useHausUi();
  const merged = composeStyles(
    paddingPx !== undefined || gapPx !== undefined
      ? {
          layout: {
            ...(paddingPx !== undefined ? { padding: insets(paddingPx) } : {}),
            ...(gapPx !== undefined ? { gap: px(gapPx) } : {}),
          },
        }
      : undefined,
    style,
  );
  return ctx.host.renderBox({ ...rest, style: merged, dataKind }, ctx);
}

export interface StackProps extends BoxProps {
  readonly align?: 'start' | 'center' | 'end' | 'stretch';
  readonly justify?: 'start' | 'center' | 'end' | 'between';
}

/** Vertical flex layout primitive. */
export function Stack({
  gapPx = 8,
  align,
  justify,
  paddingPx,
  style,
  ...rest
}: StackProps): React.ReactElement {
  const ctx = useHausUi();
  const merged = composeStyles(
    {
      layout: {
        display: 'flex',
        direction: 'column',
        gap: px(gapPx),
        ...(align ? { alignItems: align } : {}),
        ...(justify ? { justifyContent: justify } : {}),
        ...(paddingPx !== undefined ? { padding: insets(paddingPx) } : {}),
      },
    },
    style,
  );
  return ctx.host.renderBox({ ...rest, style: merged, dataKind: 'stack' }, ctx);
}

export interface RowProps extends StackProps {
  readonly wrap?: boolean;
}

/** Horizontal flex layout primitive. */
export function Row({
  gapPx = 8,
  align = 'center',
  justify,
  wrap,
  paddingPx,
  style,
  ...rest
}: RowProps): React.ReactElement {
  const ctx = useHausUi();
  const merged = composeStyles(
    {
      layout: {
        display: 'flex',
        direction: 'row',
        alignItems: align,
        gap: px(gapPx),
        ...(justify ? { justifyContent: justify } : {}),
        ...(wrap ? { wrap: 'wrap' } : {}),
        ...(paddingPx !== undefined ? { padding: insets(paddingPx) } : {}),
      },
    },
    style,
  );
  return ctx.host.renderBox({ ...rest, style: merged, dataKind: 'row' }, ctx);
}

export interface GridProps extends BoxProps {
  readonly columns?: number;
  readonly minColumnWidthPx?: number;
}

/** Grid layout primitive supporting adaptive minimum column widths. */
export function Grid({
  columns = 2,
  minColumnWidthPx = 0,
  gapPx = 12,
  paddingPx,
  style,
  ...rest
}: GridProps): React.ReactElement {
  const ctx = useHausUi();
  const merged = composeStyles(
    {
      layout: {
        display: 'grid',
        gridColumns: columns,
        gridMinColumnWidth: px(minColumnWidthPx),
        gap: px(gapPx),
        width: pct(100),
        ...(paddingPx !== undefined ? { padding: insets(paddingPx) } : {}),
      },
    },
    style,
  );
  return ctx.host.renderBox({ ...rest, style: merged, dataKind: 'grid' }, ctx);
}

export interface TextProps {
  readonly id?: string;
  readonly className?: string;
  readonly semantic?: HostTextSemantic;
  readonly htmlFor?: string;
  readonly dateTime?: string;
  readonly tone?: 'primary' | 'secondary' | 'muted' | 'accent' | 'critical';
  readonly size?: number;
  readonly weight?: 400 | 500 | 600 | 700;
  readonly mono?: boolean;
  readonly role?: string;
  readonly title?: string;
  readonly ariaLabel?: string;
  readonly ariaHidden?: boolean;
  readonly ariaLive?: 'polite' | 'assertive' | 'off';
  readonly asParagraph?: boolean;
  readonly dataAttrs?: HostDataAttrs;
  readonly surfaceTokens?: HostSurfaceTokens;
  readonly textRef?: React.Ref<unknown>;
  readonly style?: UiStyleSpec;
  readonly children?: React.ReactNode;
}

const TONE_MAP = {
  primary: 'textPrimary',
  secondary: 'textSecondary',
  muted: 'textMuted',
  accent: 'accent',
  critical: 'critical',
} as const;

export function Text({ tone, size, weight, mono, style, ...rest }: TextProps): React.ReactElement {
  const ctx = useHausUi();
  const hasTypography = tone !== undefined || size !== undefined || weight !== undefined || mono;
  const merged = composeStyles(
    hasTypography
      ? {
          typography: {
            ...(tone ? { color: colorToken(TONE_MAP[tone]) } : {}),
            ...(size !== undefined ? { size } : {}),
            ...(weight !== undefined ? { weight } : {}),
            ...(mono ? { fontFamily: 'mono', tabularNums: true } : {}),
          },
        }
      : undefined,
    style,
  );
  return ctx.host.renderText({ ...rest, style: merged, dataKind: 'text' }, ctx);
}

export interface HeadingProps {
  readonly id?: string;
  readonly className?: string;
  readonly title?: string;
  readonly tabIndex?: number;
  readonly headingRef?: React.Ref<unknown>;
  readonly level?: 1 | 2 | 3 | 4 | 5;
  readonly tone?: 'primary' | 'secondary' | 'muted' | 'accent' | 'critical';
  readonly size?: number;
  readonly weight?: 400 | 500 | 600 | 700;
  readonly dataAttrs?: HostDataAttrs;
  readonly style?: UiStyleSpec;
  readonly children?: React.ReactNode;
}

const HEADING_SIZES = { 1: 28, 2: 20, 3: 16, 4: 13.5, 5: 12.5 } as const;

export function Heading({
  level = 3,
  tone,
  size,
  weight,
  style,
  ...rest
}: HeadingProps): React.ReactElement {
  const ctx = useHausUi();
  const hasExplicitTypography = tone !== undefined || size !== undefined || weight !== undefined;
  const merged = composeStyles(
    hasExplicitTypography || !rest.className
      ? {
          typography: {
            fontFamily: level <= 2 ? 'display' : 'sans',
            size: size ?? HEADING_SIZES[level],
            weight: weight ?? 600,
            color: colorToken(TONE_MAP[tone ?? 'primary']),
          },
        }
      : undefined,
    style,
  );
  return ctx.host.renderHeading({ ...rest, level, style: merged, dataKind: 'heading' }, ctx);
}

export interface PressableProps {
  readonly id?: string;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostSurfaceTokens;
  readonly type?: 'button' | 'submit' | 'reset';
  readonly form?: string;
  readonly role?: string;
  readonly title?: string;
  readonly tabIndex?: number;
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
  readonly ariaBusy?: boolean;
  readonly ariaCurrent?: 'page' | 'step' | 'location' | 'date' | 'time' | boolean;
  readonly ariaHasPopup?: 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog' | boolean;
  readonly ariaChecked?: boolean;
  readonly ariaSelected?: boolean;
  readonly ariaPressed?: boolean;
  readonly ariaExpanded?: boolean;
  readonly ariaControls?: string;
  readonly disabled?: boolean;
  readonly stopPropagation?: boolean;
  readonly selected?: boolean;
  readonly pressableRef?: React.Ref<unknown>;
  readonly dataKind?: string;
  readonly dataVariant?: string;
  readonly dataAttrs?: HostDataAttrs;
  readonly onPress?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly onDoublePress?: () => void;
  readonly onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly onKeyDown?: (event: HostKeyEvent) => void;
  readonly children?: React.ReactNode;
}

/**
 * Interactive pressable primitive with automatic hover/pressed/focus/disabled state
 * evaluation directly from pure TypeScript `UiStyleSpec.states`.
 */
export function Pressable({
  style,
  disabled,
  selected,
  ...rest
}: PressableProps): React.ReactElement {
  const ctx = useHausUi();
  const [hovered, setHovered] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);
  const [focused, setFocused] = React.useState(false);

  const resolvedStyle = style
    ? resolveInteractiveStyle(style, { hovered, pressed, focused, disabled, selected })
    : undefined;

  return ctx.host.renderPressable(
    {
      ...rest,
      disabled,
      style: resolvedStyle,
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => {
        setHovered(false);
        setPressed(false);
      },
      onPointerDown: () => setPressed(true),
      onPointerUp: () => setPressed(false),
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
    ctx,
  );
}

export interface GlassProps extends BoxProps {
  readonly blurPx?: number;
  readonly radiusPx?: number;
  readonly refractionStrength?: number;
}

/** Liquid Glass surface container delegated cleanly through `UiHostAdapter`. */
export function Glass({
  blurPx,
  radiusPx,
  refractionStrength = 16,
  paddingPx = 16,
  style,
  ...rest
}: GlassProps): React.ReactElement {
  const ctx = useHausUi();
  const merged = composeStyles(
    {
      layout: { display: 'flex', direction: 'column', padding: insets(paddingPx) },
      material: new LiquidGlassMaterial({
        tintColor: ctx.theme.color('materialTop'),
        blurRadius: blurPx ?? ctx.theme.palette.blur.glass,
        refractionStrength,
        saturation: 1.38,
        tintOpacity: 0.24,
        rimPreset: 'card',
      }),
      corners: corners(radiusPx ?? ctx.theme.palette.radii.card, 'superellipse', 1.4),
      border: { width: 1, style: 'solid', color: colorToken('materialEdge') },
    },
    style,
  );
  return ctx.host.renderBox({ ...rest, style: merged, dataKind: 'glass-surface' }, ctx);
}

export interface DividerProps {
  readonly id?: string;
  readonly className?: string;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly style?: UiStyleSpec;
}

export function Divider({
  orientation = 'horizontal',
  style,
  ...rest
}: DividerProps): React.ReactElement {
  const ctx = useHausUi();
  const vertical = orientation === 'vertical';
  const merged = composeStyles(
    {
      layout: vertical ? { width: px(1), height: pct(100) } : { width: pct(100), height: px(1) },
      material: new SolidMaterial(colorToken('border')),
    },
    style,
  );
  return ctx.host.renderDivider({ ...rest, style: merged }, ctx);
}
