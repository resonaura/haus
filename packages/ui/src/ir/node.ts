/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BreakpointResolver,
  DEFAULT_BREAKPOINTS,
  type BorderSpec,
  type BreakpointScale,
  type ColorValue,
  type CornerRadius,
  type LayoutStyle,
  type ResponsiveValue,
  type SemanticColorToken,
  type ShadowSpec,
  type TransformSpec,
  type TypographyStyle,
  type ViewportMetrics,
} from './geometry.js';
import type { MaterialIR, SurfaceMaterial } from './materials.js';

export type UiNodeKind =
  | 'surface'
  | 'box'
  | 'stack'
  | 'grid'
  | 'split'
  | 'text'
  | 'heading'
  | 'button'
  | 'badge'
  | 'card'
  | 'modal'
  | 'tabs'
  | 'tab-panel'
  | 'switch'
  | 'slider'
  | 'input'
  | 'select'
  | 'progress'
  | 'image'
  | 'divider'
  | 'scroll'
  | 'spacer';

export interface UiInteractiveStateStyle {
  readonly material?: SurfaceMaterial | MaterialIR;
  readonly border?: BorderSpec;
  readonly opacity?: number;
  readonly transform?: TransformSpec;
  readonly textColor?: ColorValue;
  readonly shadows?: readonly ShadowSpec[];
  readonly cursor?: 'default' | 'pointer' | 'not-allowed' | 'text' | 'grab';
}

export interface UiStyleSpec {
  readonly layout?: LayoutStyle;
  readonly material?: SurfaceMaterial | MaterialIR;
  readonly typography?: TypographyStyle;
  readonly border?: BorderSpec;
  readonly corners?: CornerRadius;
  readonly shadows?: readonly ShadowSpec[];
  readonly transform?: TransformSpec;
  readonly opacity?: number;
  readonly cursor?: 'default' | 'pointer' | 'not-allowed' | 'text' | 'grab';
  readonly pointerEvents?: 'auto' | 'none';
  readonly selectNone?: boolean;
  readonly transitionMs?: number;
  readonly states?: {
    readonly hover?: UiInteractiveStateStyle;
    readonly pressed?: UiInteractiveStateStyle;
    readonly focus?: UiInteractiveStateStyle;
    readonly disabled?: UiInteractiveStateStyle;
    readonly selected?: UiInteractiveStateStyle;
  };
  readonly responsive?: Partial<
    Record<'sm' | 'md' | 'lg' | 'xl' | '2xl', Omit<UiStyleSpec, 'responsive'>>
  >;
}

export interface SerializedStyleIR {
  readonly layout?: LayoutStyle;
  readonly material?: MaterialIR;
  readonly typography?: TypographyStyle;
  readonly border?: BorderSpec;
  readonly corners?: CornerRadius;
  readonly shadows?: readonly ShadowSpec[];
  readonly transform?: TransformSpec;
  readonly opacity?: number;
  readonly cursor?: UiStyleSpec['cursor'];
  readonly pointerEvents?: UiStyleSpec['pointerEvents'];
  readonly selectNone?: boolean;
  readonly transitionMs?: number;
}

function isSurfaceMaterial(material: SurfaceMaterial | MaterialIR): material is SurfaceMaterial {
  return 'toIR' in material && typeof material.toIR === 'function';
}

export function normalizeMaterialIR(
  material?: SurfaceMaterial | MaterialIR,
): MaterialIR | undefined {
  if (!material) return undefined;
  return isSurfaceMaterial(material) ? material.toIR() : material;
}

/** Merges multiple `UiStyleSpec` layers deterministically without mutating inputs. */
export function mergeStyleSpecs(...specs: readonly (UiStyleSpec | undefined)[]): UiStyleSpec {
  let layout: LayoutStyle | undefined;
  let material: SurfaceMaterial | MaterialIR | undefined;
  let typography: TypographyStyle | undefined;
  let border: BorderSpec | undefined;
  let corners: CornerRadius | undefined;
  let shadows: readonly ShadowSpec[] | undefined;
  let transform: TransformSpec | undefined;
  let opacity: number | undefined;
  let cursor: UiStyleSpec['cursor'];
  let pointerEvents: UiStyleSpec['pointerEvents'];
  let selectNone: boolean | undefined;
  let transitionMs: number | undefined;
  let states: UiStyleSpec['states'];
  let responsive: UiStyleSpec['responsive'];

  for (const spec of specs) {
    if (!spec) continue;
    if (spec.layout) layout = { ...layout, ...spec.layout };
    if (spec.material) material = spec.material;
    if (spec.typography) typography = { ...typography, ...spec.typography };
    if (spec.border) border = spec.border;
    if (spec.corners) corners = spec.corners;
    if (spec.shadows) shadows = spec.shadows;
    if (spec.transform) transform = { ...transform, ...spec.transform };
    if (spec.opacity !== undefined) opacity = spec.opacity;
    if (spec.cursor !== undefined) cursor = spec.cursor;
    if (spec.pointerEvents !== undefined) pointerEvents = spec.pointerEvents;
    if (spec.selectNone !== undefined) selectNone = spec.selectNone;
    if (spec.transitionMs !== undefined) transitionMs = spec.transitionMs;
    if (spec.states) {
      states = {
        hover: spec.states.hover ? { ...states?.hover, ...spec.states.hover } : states?.hover,
        pressed: spec.states.pressed
          ? { ...states?.pressed, ...spec.states.pressed }
          : states?.pressed,
        focus: spec.states.focus ? { ...states?.focus, ...spec.states.focus } : states?.focus,
        disabled: spec.states.disabled
          ? { ...states?.disabled, ...spec.states.disabled }
          : states?.disabled,
        selected: spec.states.selected
          ? { ...states?.selected, ...spec.states.selected }
          : states?.selected,
      };
    }
    if (spec.responsive) {
      responsive = { ...responsive, ...spec.responsive };
    }
  }

  return {
    ...(layout ? { layout } : {}),
    ...(material ? { material } : {}),
    ...(typography ? { typography } : {}),
    ...(border ? { border } : {}),
    ...(corners ? { corners } : {}),
    ...(shadows ? { shadows } : {}),
    ...(transform ? { transform } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(pointerEvents !== undefined ? { pointerEvents } : {}),
    ...(selectNone !== undefined ? { selectNone } : {}),
    ...(transitionMs !== undefined ? { transitionMs } : {}),
    ...(states ? { states } : {}),
    ...(responsive ? { responsive } : {}),
  };
}

export type VariantMap = Readonly<Record<string, Readonly<Record<string, UiStyleSpec>>>>;

export interface StyleRecipeConfig<TVariants extends VariantMap = VariantMap> {
  readonly name: string;
  readonly base: UiStyleSpec;
  readonly variants?: TVariants;
  readonly defaultVariants?: { readonly [K in keyof TVariants]?: keyof TVariants[K] };
  readonly slots?: Readonly<Record<string, UiStyleSpec>>;
}

/**
 * Pure TypeScript OOP replacement for `tailwind-variants` / CSS class recipes.
 * Evaluates typed variant combinations into renderer-agnostic `UiStyleSpec` trees.
 */
export class StyleRecipe<TVariants extends VariantMap = VariantMap> {
  readonly name: string;
  readonly base: UiStyleSpec;
  readonly variants: TVariants;
  readonly defaultVariants: { readonly [K in keyof TVariants]?: keyof TVariants[K] };
  readonly slots: Readonly<Record<string, UiStyleSpec>>;

  constructor(config: StyleRecipeConfig<TVariants>) {
    this.name = config.name;
    this.base = config.base;
    this.variants = (config.variants ?? {}) as TVariants;
    this.defaultVariants = config.defaultVariants ?? {};
    this.slots = config.slots ?? {};
  }

  resolve(
    selection: { readonly [K in keyof TVariants]?: keyof TVariants[K] } = {},
    overrides?: UiStyleSpec,
  ): UiStyleSpec {
    const layers: (UiStyleSpec | undefined)[] = [this.base];
    for (const key of Object.keys(this.variants) as Array<keyof TVariants>) {
      const chosen = selection[key] ?? this.defaultVariants[key];
      if (chosen !== undefined) {
        layers.push(this.variants[key]?.[String(chosen)]);
      }
    }
    layers.push(overrides);
    return mergeStyleSpecs(...layers);
  }

  slot(name: string, overrides?: UiStyleSpec): UiStyleSpec {
    return mergeStyleSpecs(this.slots[name], overrides);
  }
}

export interface UiNodeEvents {
  readonly onPress?: () => void;
  readonly onChange?: (value: unknown) => void;
  readonly onInput?: (value: string) => void;
  readonly onClose?: () => void;
}

export interface UiNodeProps {
  readonly text?: string;
  readonly headingLevel?: 1 | 2 | 3 | 4;
  readonly src?: string;
  readonly alt?: string;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly checked?: boolean;
  readonly value?: string | number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly placeholder?: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly progress?: number;
  readonly indeterminate?: boolean;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly ariaPressed?: boolean;
  readonly testId?: string;
  readonly className?: string;
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
}

export interface SerializedUiNodeIR {
  readonly kind: UiNodeKind;
  readonly id?: string;
  readonly style: SerializedStyleIR;
  readonly props: Omit<UiNodeProps, 'className'>;
  readonly children: readonly SerializedUiNodeIR[];
}

/** Immutable OOP scene graph node consumable by React DOM, React Native, Rust, and C++ renderers. */
export class UiNode {
  readonly kind: UiNodeKind;
  readonly id?: string;
  readonly style: UiStyleSpec;
  readonly props: UiNodeProps;
  readonly events: UiNodeEvents;
  readonly children: readonly UiNode[];

  constructor(config: {
    readonly kind: UiNodeKind;
    readonly id?: string;
    readonly style?: UiStyleSpec;
    readonly props?: UiNodeProps;
    readonly events?: UiNodeEvents;
    readonly children?: readonly (UiNode | null | undefined | false)[];
  }) {
    this.kind = config.kind;
    this.id = config.id;
    this.style = config.style ?? {};
    this.props = config.props ?? {};
    this.events = config.events ?? {};
    this.children = (config.children ?? []).filter(
      (child): child is UiNode => child instanceof UiNode,
    );
  }

  withStyle(extra: UiStyleSpec): UiNode {
    return new UiNode({
      kind: this.kind,
      id: this.id,
      style: mergeStyleSpecs(this.style, extra),
      props: this.props,
      events: this.events,
      children: this.children,
    });
  }

  /** Serializes this node subtree into deterministic JSON IR for Rust/C++ native engines. */
  toIR(
    viewportWidth = 1280,
    breakpoints: BreakpointScale = DEFAULT_BREAKPOINTS,
  ): SerializedUiNodeIR {
    const resolved = resolveStyleForViewport(this.style, viewportWidth, breakpoints);
    const { className: _ignoredClass, ...cleanProps } = this.props;
    return {
      kind: this.kind,
      ...(this.id ? { id: this.id } : {}),
      style: {
        ...(resolved.layout ? { layout: resolved.layout } : {}),
        ...(resolved.material ? { material: normalizeMaterialIR(resolved.material) } : {}),
        ...(resolved.typography ? { typography: resolved.typography } : {}),
        ...(resolved.border ? { border: resolved.border } : {}),
        ...(resolved.corners ? { corners: resolved.corners } : {}),
        ...(resolved.shadows ? { shadows: resolved.shadows } : {}),
        ...(resolved.transform ? { transform: resolved.transform } : {}),
        ...(resolved.opacity !== undefined ? { opacity: resolved.opacity } : {}),
        ...(resolved.cursor ? { cursor: resolved.cursor } : {}),
        ...(resolved.pointerEvents ? { pointerEvents: resolved.pointerEvents } : {}),
        ...(resolved.selectNone !== undefined ? { selectNone: resolved.selectNone } : {}),
        ...(resolved.transitionMs !== undefined ? { transitionMs: resolved.transitionMs } : {}),
      },
      props: cleanProps,
      children: this.children.map((child) => child.toIR(viewportWidth, breakpoints)),
    };
  }
}

export function resolveStyleForViewport(
  style: UiStyleSpec,
  viewportWidth: number,
  breakpoints: BreakpointScale = DEFAULT_BREAKPOINTS,
): UiStyleSpec {
  if (!style.responsive) return style;
  const resolver = new BreakpointResolver(breakpoints);
  const layers: (UiStyleSpec | undefined)[] = [style];
  for (const bp of ['sm', 'md', 'lg', 'xl', '2xl'] as const) {
    if (resolver.matches(viewportWidth, bp) && style.responsive[bp]) {
      layers.push(style.responsive[bp]);
    }
  }
  return mergeStyleSpecs(...layers);
}

export type ThemeMode = 'light' | 'dark';

export interface ThemePalette {
  readonly mode: ThemeMode;
  readonly colors: Readonly<Record<SemanticColorToken, ColorValue>>;
  readonly fontFamilies: {
    readonly sans: string;
    readonly mono: string;
    readonly display: string;
  };
  readonly radii: {
    readonly control: number;
    readonly field: number;
    readonly inset: number;
    readonly card: number;
    readonly panel: number;
    readonly pill: number;
  };
  readonly blur: {
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly glass: number;
  };
  readonly breakpoints: BreakpointScale;
}

/** Composable OOP theme engine resolving semantic tokens, recipes, and responsive metrics. */
export class UiTheme {
  readonly mode: ThemeMode;
  readonly palette: ThemePalette;
  readonly breakpoints: BreakpointResolver;
  private readonly recipes: Map<string, StyleRecipe>;

  constructor(palette: ThemePalette, recipes: readonly StyleRecipe[] = []) {
    this.mode = palette.mode;
    this.palette = palette;
    this.breakpoints = new BreakpointResolver(palette.breakpoints);
    this.recipes = new Map(recipes.map((recipe) => [recipe.name, recipe]));
  }

  color(token: SemanticColorToken): ColorValue {
    return this.palette.colors[token];
  }

  resolveResponsive<T>(value: T | ResponsiveValue<T>, viewport: ViewportMetrics): T {
    return this.breakpoints.resolve(value, viewport.width);
  }

  recipe(name: string): StyleRecipe | undefined {
    return this.recipes.get(name);
  }

  withRecipe(recipe: StyleRecipe): UiTheme {
    const next = Array.from(this.recipes.values()).filter((item) => item.name !== recipe.name);
    next.push(recipe);
    return new UiTheme(this.palette, next);
  }
}

/** Standard OOP contract implemented by every renderer-agnostic component blueprint in `@haus/ui`. */
export interface UiComponent<TProps> {
  readonly name: string;
  build(props: TProps, theme: UiTheme, viewport: ViewportMetrics): UiNode;
}
