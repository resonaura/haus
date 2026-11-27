/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactElement, ReactNode } from 'react';
import { motion } from '@gpuix/react';
import { Dialog, DialogBackdrop, DialogPopup, DialogPortal } from '@gpuix/react/dialog';
import type { UiStyleSpec } from '../ir/node.js';
import type { RenderContext } from '../renderers/contract.js';
import { styleFor } from './style.js';

const BACKDROP_INITIAL = { opacity: 0 } as const;
const BACKDROP_OPEN = { opacity: 1 } as const;
const BACKDROP_CLOSE = { opacity: 0 } as const;
const BACKDROP_TRANSITION_OPEN = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};
const BACKDROP_TRANSITION_CLOSE = {
  duration: 0.15,
  ease: [0.4, 0, 1, 1] as [number, number, number, number],
};

const PANEL_INITIAL = { opacity: 0, scale: 0.96, y: 10 } as const;
const PANEL_OPEN = { opacity: 1, scale: 1, y: 0 } as const;
const PANEL_CLOSE = { opacity: 0, scale: 0.96, y: 8 } as const;
const PANEL_TRANSITION_OPEN = {
  duration: 0.21,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};
const PANEL_TRANSITION_CLOSE = {
  duration: 0.155,
  ease: [0.4, 0, 1, 1] as [number, number, number, number],
};

export interface GpuiDialogFrameProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly closing?: boolean;
  readonly backdrop: UiStyleSpec;
  readonly panel: UiStyleSpec;
  readonly children: ReactNode;
}

/**
 * GPUIX native modal frame with smooth enter/exit animations and click-through-proof
 * backdrop dismissal (closes on completed primary `onClick`, never on `onMouseDown`,
 * keeping full window occlusion active through the exit transition).
 */
export function renderGpuiDialogFrame(
  { title, onClose, closing = false, backdrop, panel, children }: GpuiDialogFrameProps,
  context: RenderContext,
): ReactElement {
  const backdropStyle = styleFor(backdrop, context);
  const panelStyle = styleFor(panel, context);
  const reduced = context.viewport.reducedMotion;
  const isCover = panelStyle.height === '100%';
  const backdropBase = {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: 'auto' as const,
    backgroundColor: backdropStyle.backgroundColor,
    ...(backdropStyle.backdropBlur !== undefined
      ? { backdropBlur: backdropStyle.backdropBlur }
      : {}),
  };
  const panelInnerStyle = {
    ...panelStyle,
    width: '100%' as const,
    maxWidth: '100%' as const,
    maxHeight: '100%' as const,
    minHeight: 0,
    flexShrink: 1,
    ...(isCover ? { height: '100%' as const } : {}),
    pointerEvents: 'auto' as const,
    transformOrigin: { x: 0.5, y: 0.5 },
  };
  const popupShellStyle = {
    backgroundColor: 'transparent',
    pointerEvents: 'none' as const,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    ...(panelStyle.width !== undefined ? { width: panelStyle.width } : {}),
    ...(panelStyle.minWidth !== undefined ? { minWidth: panelStyle.minWidth } : {}),
    ...(panelStyle.maxWidth !== undefined ? { maxWidth: panelStyle.maxWidth } : {}),
    ...(panelStyle.height !== undefined ? { height: panelStyle.height } : {}),
    ...(panelStyle.maxHeight !== undefined ? { maxHeight: panelStyle.maxHeight } : {}),
  };
  const handleBackdropClick = () => {
    if (!closing) onClose();
  };

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !closing) onClose();
      }}
    >
      <DialogPortal
        style={{
          paddingTop: backdropStyle.paddingTop,
          paddingRight: backdropStyle.paddingRight,
          paddingBottom: backdropStyle.paddingBottom,
          paddingLeft: backdropStyle.paddingLeft,
          alignItems: backdropStyle.alignItems,
          justifyContent: backdropStyle.justifyContent,
        }}
      >
        {reduced ? (
          <DialogBackdrop
            testId="dialog-backdrop"
            style={backdropBase}
            onClick={handleBackdropClick}
          />
        ) : (
          <motion.div
            testId="dialog-backdrop"
            style={backdropBase}
            initial={BACKDROP_INITIAL}
            animate={closing ? BACKDROP_CLOSE : BACKDROP_OPEN}
            transition={closing ? BACKDROP_TRANSITION_CLOSE : BACKDROP_TRANSITION_OPEN}
            onClick={handleBackdropClick}
          />
        )}
        {reduced ? (
          <DialogPopup testId="dialog-panel" aria-label={title} style={panelStyle}>
            {children}
          </DialogPopup>
        ) : (
          <DialogPopup style={popupShellStyle}>
            <motion.div
              testId="dialog-panel"
              aria-label={title}
              style={panelInnerStyle}
              initial={PANEL_INITIAL}
              animate={closing ? PANEL_CLOSE : PANEL_OPEN}
              transition={closing ? PANEL_TRANSITION_CLOSE : PANEL_TRANSITION_OPEN}
            >
              {children}
            </motion.div>
          </DialogPopup>
        )}
      </DialogPortal>
    </Dialog>
  );
}
