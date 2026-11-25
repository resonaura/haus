/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { insets, pct, px } from '../ir/geometry.js';
import type { UiStyleSpec } from '../ir/node.js';
import type { HostDataAttrs, HostPointerEvent, HostSurfaceTokens } from '../renderers/host.js';
import { dialogStyles, type DialogStyleProps } from '../styles/overlays.js';
import { composeStyles } from '../styles/sheet.js';
import { useHausStyles, useHausUi } from './context.js';
import { Box, Heading, Pressable, Row } from './elements.js';

type ModalContainerSize = 'xs' | 'sm' | 'md' | 'lg' | 'full' | 'cover';

interface ModalOverlayCtx {
  readonly onClose: () => void;
  readonly dismissableRef: React.MutableRefObject<boolean>;
}

const ModalOverlayContext = React.createContext<ModalOverlayCtx | null>(null);
const ModalContainerContext = React.createContext<ModalContainerSize>('md');

function resolveDialogSize(size: ModalContainerSize): DialogStyleProps['size'] {
  if (size === 'cover' || size === 'full') return 'cover';
  if (size === 'xs' || size === 'sm') return 'sm';
  if (size === 'lg') return 'lg';
  return 'md';
}

export interface HausModalRootProps {
  readonly isOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly children?: React.ReactNode;
}

function ModalRoot({
  isOpen = true,
  onOpenChange,
  children,
}: HausModalRootProps): React.ReactElement | null {
  const ctx = useHausUi();
  const dismissableRef = React.useRef(true);
  const onClose = React.useCallback(() => onOpenChange?.(false), [onOpenChange]);

  React.useEffect(() => {
    if (!isOpen) return undefined;
    return ctx.host.subscribeEscape?.(() => {
      if (dismissableRef.current) onClose();
    });
  }, [isOpen, onClose, ctx.host]);

  if (!isOpen) return null;

  const content = (
    <ModalOverlayContext.Provider value={{ onClose, dismissableRef }}>
      {children}
    </ModalOverlayContext.Provider>
  );
  return <>{ctx.portal ? ctx.portal(content) : content}</>;
}

function ModalBackdrop({
  isOpen,
  onOpenChange,
  isDismissable = true,
  variant = 'blur',
  className,
  style,
  onPointerDownCapture,
  children,
}: {
  readonly isOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly isDismissable?: boolean;
  readonly variant?: 'blur' | 'liquid-glass' | 'dim' | 'opaque' | 'transparent';
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly onPointerDownCapture?: (event: HostPointerEvent) => void;
  readonly children?: React.ReactNode;
}): React.ReactElement | null {
  const ctx = useHausUi();
  const parentCtx = React.useContext(ModalOverlayContext);
  const standaloneDismissableRef = React.useRef(isDismissable);
  standaloneDismissableRef.current = isDismissable;

  React.useEffect(() => {
    if (parentCtx) parentCtx.dismissableRef.current = isDismissable;
  }, [parentCtx, isDismissable]);

  const standaloneClose = React.useCallback(() => onOpenChange?.(false), [onOpenChange]);
  const isStandalone = !parentCtx && (isOpen !== undefined || onOpenChange !== undefined);

  React.useEffect(() => {
    if (!isStandalone || isOpen === false) return undefined;
    return ctx.host.subscribeEscape?.(() => {
      if (standaloneDismissableRef.current) standaloneClose();
    });
  }, [isStandalone, isOpen, standaloneClose, ctx.host]);

  const backdropMode =
    variant === 'liquid-glass' ? 'liquid-glass' : variant === 'blur' ? 'blur' : 'dim';
  const styles = useHausStyles(dialogStyles, { size: 'md', backdrop: backdropMode });

  if (isOpen === false) return null;

  const handleClose = () => {
    if (!isDismissable) return;
    if (onOpenChange) onOpenChange(false);
    else parentCtx?.onClose();
  };

  const backdropNode = (
    <Box
      className={['modal__backdrop', className].filter(Boolean).join(' ')}
      style={composeStyles(styles.backdrop, style)}
      dataKind="modal-backdrop"
      onBackdropPress={handleClose}
      onPointerDownCapture={onPointerDownCapture}
    >
      {children}
    </Box>
  );

  if (isStandalone) {
    const wrapped = (
      <ModalOverlayContext.Provider
        value={{ onClose: standaloneClose, dismissableRef: standaloneDismissableRef }}
      >
        {backdropNode}
      </ModalOverlayContext.Provider>
    );
    return <>{ctx.portal ? ctx.portal(wrapped) : wrapped}</>;
  }

  return backdropNode;
}

function ModalContainer({
  placement = 'center',
  size = 'md',
  className,
  style,
  children,
}: {
  readonly placement?: 'center' | 'top' | 'bottom' | 'auto';
  readonly scroll?: 'inside' | 'outside';
  readonly size?: ModalContainerSize;
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const modalCtx = React.useContext(ModalOverlayContext);
  const isFullViewport = size === 'cover' || size === 'full';
  const alignItems =
    size === 'cover'
      ? 'stretch'
      : placement === 'top'
        ? 'start'
        : placement === 'bottom'
          ? 'end'
          : 'center';

  return (
    <Box
      className={['modal__container', className].filter(Boolean).join(' ')}
      style={composeStyles(
        {
          layout: isFullViewport
            ? {
                position: 'fixed',
                inset: insets(0),
                width: pct(100),
                height: pct(100),
                display: 'flex',
                alignItems,
                justifyContent: 'center',
                ...(className ? {} : { padding: insets(size === 'cover' ? 12 : 0) }),
              }
            : {
                width: pct(100),
                height: pct(100),
                display: 'flex',
                alignItems,
                justifyContent: 'center',
              },
        },
        style,
      )}
      dataKind="modal-container"
      onBackdropPress={() => {
        if (modalCtx?.dismissableRef.current !== false) modalCtx?.onClose();
      }}
    >
      <ModalContainerContext.Provider value={size}>{children}</ModalContainerContext.Provider>
    </Box>
  );
}

function ModalDialog({
  size,
  className,
  style,
  surfaceTokens,
  'data-controller-kind': dataControllerKind,
  'data-active': dataActive,
  'data-pending': dataPending,
  'data-light-effect': dataLightEffect,
  'data-camera-view': dataCameraView,
  'data-video-fill': dataVideoFill,
  children,
}: {
  readonly size?: DialogStyleProps['size'];
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly surfaceTokens?: HostSurfaceTokens;
  readonly 'data-controller-kind'?: string;
  readonly 'data-active'?: boolean;
  readonly 'data-pending'?: boolean;
  readonly 'data-light-effect'?: string;
  readonly 'data-camera-view'?: string;
  readonly 'data-video-fill'?: boolean | string;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const containerSize = React.useContext(ModalContainerContext);
  const styles = useHausStyles(dialogStyles, {
    size: size ?? resolveDialogSize(containerSize),
    backdrop: 'blur',
  });
  const dataAttrs: HostDataAttrs = {
    'data-controller-kind': dataControllerKind,
    'data-active': dataActive,
    'data-pending': dataPending,
    'data-light-effect': dataLightEffect,
    'data-camera-view': dataCameraView,
    'data-video-fill': dataVideoFill,
  };
  return (
    <Box
      role="dialog"
      ariaModal
      className={['modal__dialog', className].filter(Boolean).join(' ')}
      style={composeStyles(styles.panel, style)}
      surfaceTokens={surfaceTokens}
      dataAttrs={dataAttrs}
      dataKind="modal"
    >
      {children}
    </Box>
  );
}

function ModalCloseTrigger({
  isDisabled,
  className,
  ariaLabel,
  'aria-label': ariaLabelAttr,
}: {
  readonly isDisabled?: boolean;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly 'aria-label'?: string;
}): React.ReactElement {
  const modalCtx = React.useContext(ModalOverlayContext);
  const containerSize = React.useContext(ModalContainerContext);
  const isCover = containerSize === 'cover';
  const styles = useHausStyles(dialogStyles, {
    size: resolveDialogSize(containerSize),
    backdrop: 'blur',
  });
  return (
    <Pressable
      ariaLabel={ariaLabel ?? ariaLabelAttr ?? 'Close dialog'}
      disabled={isDisabled}
      className={['modal__close-trigger', className].filter(Boolean).join(' ')}
      style={composeStyles(styles.closeButton, {
        layout: {
          position: 'absolute',
          zIndex: 12,
          ...(isCover
            ? {
                width: px(38),
                height: px(38),
                inset: { top: px(22), right: px(24) },
              }
            : {
                inset: { top: px(16), right: px(16) },
              }),
        },
      })}
      onPress={() => modalCtx?.onClose()}
    >
      ×
    </Pressable>
  );
}

function ModalHeader({
  className,
  style,
  children,
}: {
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  return (
    <Box className={['modal__header', className].filter(Boolean).join(' ')} style={style}>
      {children}
    </Box>
  );
}

function ModalHeading({
  className,
  children,
}: {
  readonly className?: string;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  return (
    <Heading level={2} className={['modal__heading', className].filter(Boolean).join(' ')}>
      {children}
    </Heading>
  );
}

function ModalBody({
  className,
  style,
  children,
}: {
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  return (
    <Box className={['modal__body', className].filter(Boolean).join(' ')} style={style}>
      {children}
    </Box>
  );
}

function ModalFooter({
  className,
  style,
  children,
}: {
  readonly className?: string;
  readonly style?: UiStyleSpec;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const styles = useHausStyles(dialogStyles, { size: 'md', backdrop: 'blur' });
  return (
    <Row
      className={['modal__footer', className].filter(Boolean).join(' ')}
      style={composeStyles(styles.footer, style)}
    >
      {children}
    </Row>
  );
}

/**
 * Compound adapter-backed modal overlay (`HausModalOverlay.Backdrop`, `.Container`, `.Dialog`,
 * `.Header`, `.Heading`, `.Body`, `.Footer`, `.CloseTrigger`) — ZERO direct HTML tags.
 */
export const HausModalOverlay = Object.assign(ModalRoot, {
  Backdrop: ModalBackdrop,
  Container: ModalContainer,
  Dialog: ModalDialog,
  CloseTrigger: ModalCloseTrigger,
  Header: ModalHeader,
  Heading: ModalHeading,
  Body: ModalBody,
  Footer: ModalFooter,
});
