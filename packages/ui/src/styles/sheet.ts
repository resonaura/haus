/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ViewportMetrics } from '../ir/geometry.js';
import {
  mergeStyleSpecs,
  type UiInteractiveStateStyle,
  type UiStyleSpec,
  type UiTheme,
} from '../ir/node.js';

export type StyleSlotMap = Readonly<Record<string, UiStyleSpec>>;

export type StyleSheetFactory<TSlots extends StyleSlotMap, TProps = void> = (
  theme: UiTheme,
  props: TProps,
  viewport: ViewportMetrics,
) => TSlots;

export interface InteractionFlags {
  readonly hovered?: boolean;
  readonly pressed?: boolean;
  readonly focused?: boolean;
  readonly disabled?: boolean;
  readonly selected?: boolean;
}

/**
 * Pure TypeScript OOP stylesheet — zero CSS/SCSS/Tailwind strings.
 * Evaluates typed `UiStyleSpec` slot maps against `UiTheme` and `ViewportMetrics`
 * so the same stylesheet drives React DOM, React Native, and Native (Rust/C++) renderers.
 */
export class HausStyleSheet<TSlots extends StyleSlotMap, TProps = void> {
  constructor(
    readonly name: string,
    private readonly factory: StyleSheetFactory<TSlots, TProps>,
  ) {}

  resolve(theme: UiTheme, props: TProps, viewport: ViewportMetrics): TSlots {
    return this.factory(theme, props, viewport);
  }
}

/** Declares a typed, theme- and viewport-aware pure TypeScript stylesheet. */
export function defineStyleSheet<TSlots extends StyleSlotMap, TProps = void>(
  name: string,
  factory: StyleSheetFactory<TSlots, TProps>,
): HausStyleSheet<TSlots, TProps> {
  return new HausStyleSheet(name, factory);
}

/** Deterministically composes multiple `UiStyleSpec` layers without mutating inputs. */
export function composeStyles(...specs: readonly (UiStyleSpec | undefined | false)[]): UiStyleSpec {
  const valid = specs.filter((spec): spec is UiStyleSpec => Boolean(spec));
  return mergeStyleSpecs(...valid);
}

function applyStateOverlay(base: UiStyleSpec, overlay?: UiInteractiveStateStyle): UiStyleSpec {
  if (!overlay) return base;
  return mergeStyleSpecs(base, {
    ...(overlay.material ? { material: overlay.material } : {}),
    ...(overlay.border ? { border: overlay.border } : {}),
    ...(overlay.opacity !== undefined ? { opacity: overlay.opacity } : {}),
    ...(overlay.transform ? { transform: overlay.transform } : {}),
    ...(overlay.shadows ? { shadows: overlay.shadows } : {}),
    ...(overlay.cursor ? { cursor: overlay.cursor } : {}),
    ...(overlay.textColor ? { typography: { ...base.typography, color: overlay.textColor } } : {}),
  });
}

/**
 * Evaluates declarative `states` (`hover`, `pressed`, `focus`, `selected`, `disabled`)
 * from a `UiStyleSpec` into a concrete resolved `UiStyleSpec` for any target renderer.
 */
export function resolveInteractiveStyle(spec: UiStyleSpec, flags: InteractionFlags): UiStyleSpec {
  if (!spec.states) return spec;
  let current = spec;
  if (flags.selected) current = applyStateOverlay(current, spec.states.selected);
  if (flags.hovered && !flags.disabled) current = applyStateOverlay(current, spec.states.hover);
  if (flags.focused && !flags.disabled) current = applyStateOverlay(current, spec.states.focus);
  if (flags.pressed && !flags.disabled) current = applyStateOverlay(current, spec.states.pressed);
  if (flags.disabled) current = applyStateOverlay(current, spec.states.disabled);
  return current;
}
