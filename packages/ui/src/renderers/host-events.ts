/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface HostPointerEvent {
  readonly target: unknown;
  readonly currentTarget: { contains(node: unknown): boolean };
  stopPropagation(): void;
}

export type HostDataAttrs = Readonly<Record<string, string | boolean | undefined>>;
export type HostSurfaceTokens = Readonly<Record<string, string | number | undefined>>;

export type HostBoxSemantic =
  | 'box'
  | 'section'
  | 'header'
  | 'footer'
  | 'main'
  | 'aside'
  | 'nav'
  | 'article'
  | 'list'
  | 'ordered-list'
  | 'listitem'
  | 'dl'
  | 'dt'
  | 'dd'
  | 'fieldset'
  | 'legend'
  | 'table'
  | 'colgroup'
  | 'col'
  | 'thead'
  | 'tbody'
  | 'tr'
  | 'th'
  | 'td';

export type HostTextSemantic =
  | 'span'
  | 'p'
  | 'strong'
  | 'small'
  | 'em'
  | 'label'
  | 'swatch'
  | 'kbd'
  | 'time'
  | 'output'
  | 'bold'
  | 'break';

export interface HostBlurEvent {
  readonly currentTarget: { contains(node: unknown): boolean };
  readonly relatedTarget: unknown;
}

export interface HostKeyEvent {
  readonly key: string;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly target: unknown;
  readonly currentTarget: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface HostScrollEvent {
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

export interface HostTouchEvent {
  readonly currentTarget: {
    scrollTo(options: { left: number; behavior: 'instant' }): void;
    setChildStyleProperty(name: string, value: string): void;
  };
}
