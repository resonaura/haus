/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type * as React from 'react';
import { wrapSurfacePointerEvent } from './dom-media.js';
import type {
  HostBoxProps,
  HostBoxSemantic,
  HostDataAttrs,
  HostSurfaceTokens,
  HostTextSemantic,
} from './host.js';

export const BOX_SEMANTIC_TAG: Readonly<Record<HostBoxSemantic, string>> = {
  box: 'div',
  section: 'section',
  header: 'header',
  footer: 'footer',
  main: 'main',
  aside: 'aside',
  nav: 'nav',
  article: 'article',
  list: 'ul',
  'ordered-list': 'ol',
  listitem: 'li',
  dl: 'dl',
  dt: 'dt',
  dd: 'dd',
  fieldset: 'fieldset',
  legend: 'legend',
  table: 'table',
  colgroup: 'colgroup',
  col: 'col',
  thead: 'thead',
  tbody: 'tbody',
  tr: 'tr',
  th: 'th',
  td: 'td',
};

export const TEXT_SEMANTIC_TAG: Readonly<Record<HostTextSemantic, string>> = {
  span: 'span',
  p: 'p',
  strong: 'strong',
  small: 'small',
  em: 'em',
  label: 'label',
  swatch: 'i',
  kbd: 'kbd',
  time: 'time',
  output: 'output',
  bold: 'b',
  break: 'br',
};

export function mergeSurfaceStyle(
  base: React.CSSProperties,
  tokens?: HostSurfaceTokens,
): React.CSSProperties {
  if (!tokens) return base;
  const merged: Record<string, string | number | undefined> = {
    ...(base as Record<string, string | number | undefined>),
  };
  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as React.CSSProperties;
}

export function collectDataAttrs(attrs?: HostDataAttrs): Record<string, string> {
  if (!attrs) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    const attrName = key.startsWith('data-') ? key : `data-${key}`;
    result[attrName] = value === true ? '' : value;
  }
  return result;
}

export function buildDomBoxProps(
  props: HostBoxProps,
  mergedStyle: React.CSSProperties,
  shaderId?: string,
): Record<string, unknown> {
  const dataProps = collectDataAttrs(props.dataAttrs);
  return {
    ref: props.boxRef as React.Ref<HTMLElement> | undefined,
    id: props.id,
    className: props.className,
    style: mergedStyle,
    role: props.role,
    title: props.title,
    tabIndex: props.tabIndex,
    hidden: props.hidden,
    inert: props.inert,
    disabled: props.disabled,
    draggable: props.draggable,
    'aria-label': props.ariaLabel,
    'aria-labelledby': props.ariaLabelledBy,
    'aria-describedby': props.ariaDescribedBy,
    'aria-modal': props.ariaModal,
    'aria-hidden': props.ariaHidden,
    'aria-busy': props.ariaBusy,
    'aria-selected': props.ariaSelected,
    'aria-expanded': props.ariaExpanded,
    'aria-level': props.ariaLevel,
    'aria-live': props.ariaLive,
    'aria-sort': props.ariaSort,
    'aria-keyshortcuts': props.ariaKeyShortcuts,
    'aria-valuemin': props.ariaValueMin,
    'aria-valuemax': props.ariaValueMax,
    'aria-valuenow': props.ariaValueNow,
    'data-haus-kind': props.dataKind ?? 'box',
    'data-haus-shader': shaderId,
    ...dataProps,
    onClick:
      props.onPress || props.onBackdropPress || props.stopPropagation
        ? (event: React.MouseEvent<HTMLElement>) => {
            if (props.stopPropagation) event.stopPropagation();
            props.onPress?.();
            if (props.onBackdropPress && event.target === event.currentTarget) {
              props.onBackdropPress();
            }
          }
        : undefined,
    onPointerDown: props.onPointerDownEvent
      ? (event: React.PointerEvent<HTMLElement>) => {
          props.onPointerDown?.();
          props.onPointerDownEvent?.(wrapSurfacePointerEvent(event));
        }
      : props.onPointerDown,
    onPointerMove: props.onPointerMoveEvent
      ? (event: React.PointerEvent<HTMLElement>) =>
          props.onPointerMoveEvent?.(wrapSurfacePointerEvent(event))
      : undefined,
    onPointerUp: props.onPointerUpEvent
      ? (event: React.PointerEvent<HTMLElement>) =>
          props.onPointerUpEvent?.(wrapSurfacePointerEvent(event))
      : undefined,
    onPointerCancel: props.onPointerCancel,
    onScroll: props.onScroll
      ? (event: React.UIEvent<HTMLElement>) =>
          props.onScroll?.({
            scrollLeft: event.currentTarget.scrollLeft,
            scrollTop: event.currentTarget.scrollTop,
          })
      : undefined,
    onTouchStart: props.onTouchStart
      ? (event: React.TouchEvent<HTMLElement>) => {
          const target = event.currentTarget;
          props.onTouchStart?.({
            currentTarget: {
              scrollTo: (options) => target.scrollTo(options),
              setChildStyleProperty: (name, value) => {
                const first = target.firstElementChild;
                if (first instanceof HTMLElement) first.style.setProperty(name, value);
              },
            },
          });
        }
      : undefined,
    onTouchMove: props.onTouchMove,
    onPointerDownCapture: props.onPointerDownCapture
      ? (event: React.PointerEvent<HTMLElement>) => {
          const current = event.currentTarget;
          props.onPointerDownCapture?.({
            target: event.target,
            currentTarget: {
              contains: (node: unknown) => node instanceof Node && current.contains(node),
            },
            stopPropagation: () => event.stopPropagation(),
          });
        }
      : undefined,
    onContextMenu:
      props.onContextMenu || props.onSecondaryPress
        ? (event: React.MouseEvent<HTMLElement>) => {
            props.onContextMenu?.(event);
            if (props.onSecondaryPress && !event.defaultPrevented) {
              event.preventDefault();
              props.onSecondaryPress();
            }
          }
        : undefined,
    onDragStart: props.onDragStart,
    onDragOver: props.onDragOver,
    onDragEnd: props.onDragEnd,
    onDrop: props.onDrop,
    onKeyDown: props.onKeyDown
      ? (event: React.KeyboardEvent<HTMLElement>) => {
          props.onKeyDown?.({
            key: event.key,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            target: event.target,
            currentTarget: event.currentTarget,
            preventDefault: () => event.preventDefault(),
            stopPropagation: () => event.stopPropagation(),
          });
        }
      : undefined,
    onFocusCapture: props.onFocusCapture,
    onBlurCapture: props.onBlurCapture
      ? (event: React.FocusEvent<HTMLElement>) => {
          const current = event.currentTarget;
          props.onBlurCapture?.({
            currentTarget: {
              contains: (node: unknown) => node instanceof Node && current.contains(node),
            },
            relatedTarget: event.relatedTarget,
          });
        }
      : undefined,
    onDragStartCapture: props.onDragStartCapture,
    onDragEndCapture: props.onDragEndCapture,
    onMouseEnter: props.onPointerEnter,
    onMouseLeave: props.onPointerLeave,
  };
}
