/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { FloatingLayer, floatingRootStyle } from '@gpuix/react/floating';
import type { UiStyleSpec } from '../ir/node.js';
import type { RenderContext } from '../renderers/contract.js';
import { styleFor } from './style.js';

export function GpuiPopover({
  id,
  open,
  placement,
  align = 'start',
  anchorStyle,
  surfaceStyle,
  trigger,
  children,
  context,
}: {
  readonly id?: string;
  readonly open: boolean;
  readonly placement: 'top' | 'bottom' | 'left' | 'right';
  readonly align?: 'start' | 'center' | 'end';
  readonly onOpenChange?: (open: boolean) => void;
  readonly anchorStyle: UiStyleSpec;
  readonly surfaceStyle: UiStyleSpec;
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly context: RenderContext;
}) {
  const {
    position: _position,
    top: _top,
    right: _right,
    bottom: _bottom,
    left: _left,
    marginTop: _marginTop,
    marginRight: _marginRight,
    marginBottom: _marginBottom,
    marginLeft: _marginLeft,
    ...panelStyle
  } = styleFor(surfaceStyle, context);

  return (
    <div style={floatingRootStyle(styleFor(anchorStyle, context))}>
      {trigger}
      {open && (
        <FloatingLayer
          testId={id}
          role="dialog"
          side={placement}
          align={align}
          sideOffset={8}
          style={panelStyle}
        >
          {children}
        </FloatingLayer>
      )}
    </div>
  );
}
