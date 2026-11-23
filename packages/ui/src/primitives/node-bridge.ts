/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { UiNode } from '../ir/node.js';
import type { HausUiContextValue } from './context.js';

/** Renders any pure OOP `UiNode` tree strictly through the active `UiHostAdapter`. */
export function renderUiNodeThroughHost(node: UiNode, ctx: HausUiContextValue): React.ReactElement {
  const renderedChildren: React.ReactNode[] = [];
  if (node.props.text !== undefined) renderedChildren.push(node.props.text);
  node.children.forEach((child, idx) => {
    const el = renderUiNodeThroughHost(child, ctx);
    renderedChildren.push(React.cloneElement(el, { key: child.id ?? `${child.kind}-${idx}` }));
  });
  const children = renderedChildren.length > 0 ? renderedChildren : undefined;

  switch (node.kind) {
    case 'button':
    case 'switch':
      return ctx.host.renderPressable(
        {
          id: node.id,
          className: node.props.className,
          style: node.style,
          role: node.props.role,
          ariaLabel: node.props.ariaLabel,
          ariaChecked: node.props.checked,
          ariaPressed: node.props.ariaPressed,
          disabled: node.props.disabled,
          dataKind: node.kind,
          onPress: node.events.onPress,
          children,
        },
        ctx,
      );
    case 'text':
    case 'badge':
      return ctx.host.renderText(
        {
          id: node.id,
          className: node.props.className,
          style: node.style,
          role: node.props.role,
          ariaLabel: node.props.ariaLabel,
          dataKind: node.kind,
          children,
        },
        ctx,
      );
    case 'heading':
      return ctx.host.renderHeading(
        {
          id: node.id,
          className: node.props.className,
          style: node.style,
          level: node.props.headingLevel,
          dataKind: node.kind,
          children,
        },
        ctx,
      );
    case 'image':
      return ctx.host.renderImage(
        {
          id: node.id,
          className: node.props.className,
          src: node.props.src ?? '',
          alt: node.props.alt,
          style: node.style,
        },
        ctx,
      );
    case 'divider':
      return ctx.host.renderDivider(
        { id: node.id, className: node.props.className, style: node.style },
        ctx,
      );
    case 'input':
      return ctx.host.renderTextInput(
        {
          id: node.id,
          className: node.props.className,
          value: String(node.props.value ?? ''),
          placeholder: node.props.placeholder,
          disabled: node.props.disabled,
          ariaLabel: node.props.ariaLabel,
          style: node.style,
          onChange: node.events.onInput,
        },
        ctx,
      );
    case 'select':
      return ctx.host.renderSelect(
        {
          id: node.id,
          className: node.props.className,
          value: String(node.props.value ?? ''),
          options: node.props.options ?? [],
          disabled: node.props.disabled,
          ariaLabel: node.props.ariaLabel,
          style: node.style,
          onChange: (value) => node.events.onChange?.(value),
        },
        ctx,
      );
    case 'scroll':
      return ctx.host.renderScrollView(
        { id: node.id, className: node.props.className, style: node.style, children },
        ctx,
      );
    default:
      return ctx.host.renderBox(
        {
          id: node.id,
          className: node.props.className,
          style: node.style,
          role: node.props.role,
          ariaLabel: node.props.ariaLabel,
          dataKind: node.kind,
          children,
        },
        ctx,
      );
  }
}
