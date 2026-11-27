/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import type { UiMotionSpec } from '../ir/motion.js';

export const DIALOG_EXIT_DURATION_MS = 160;
export const DIALOG_ENTER_EASE = [0.22, 1, 0.36, 1] as const;
export const DIALOG_EXIT_EASE = [0.4, 0, 1, 1] as const;

export const HausDialogCloseContext = React.createContext<(() => void) | null>(null);

/** Returns a close trigger that plays the dialog's smooth exit animation before unmounting. */
export function useHausDialogClose(): (() => void) | null {
  return React.useContext(HausDialogCloseContext);
}

/** Manages smooth enter/exit lifecycle for dialogs rendered via either `open` toggles or conditional unmount. */
export function useDialogTransition({
  open,
  reducedMotion,
  onClose,
}: {
  readonly open: boolean;
  readonly reducedMotion: boolean;
  readonly onClose: () => void;
}): {
  readonly mounted: boolean;
  readonly closing: boolean;
  readonly requestClose: () => void;
} {
  const exitMs = reducedMotion ? 0 : DIALOG_EXIT_DURATION_MS;
  const [mounted, setMounted] = React.useState(open);
  const [closing, setClosing] = React.useState(false);
  const exitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  const clearExitTimer = React.useCallback(() => {
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => clearExitTimer, [clearExitTimer]);

  React.useEffect(() => {
    if (open) {
      clearExitTimer();
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    if (exitMs <= 0) {
      setMounted(false);
      setClosing(false);
      return;
    }
    setClosing(true);
    clearExitTimer();
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      setMounted(false);
      setClosing(false);
    }, exitMs);
  }, [open, mounted, exitMs, clearExitTimer]);

  const requestClose = React.useCallback(() => {
    if (closing) return;
    if (exitMs <= 0) {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    clearExitTimer();
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      onCloseRef.current();
    }, exitMs);
  }, [closing, exitMs, clearExitTimer]);

  return { mounted, closing, requestClose };
}

const BACKDROP_MOTION_OPEN: UiMotionSpec = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  durationMs: 180,
  ease: DIALOG_ENTER_EASE,
};

const BACKDROP_MOTION_CLOSE: UiMotionSpec = {
  initial: { opacity: 0 },
  animate: { opacity: 0 },
  durationMs: 150,
  ease: DIALOG_EXIT_EASE,
};

const PANEL_MOTION_OPEN: UiMotionSpec = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  durationMs: 210,
  ease: DIALOG_ENTER_EASE,
  originX: 0.5,
  originY: 0.5,
};

const PANEL_MOTION_CLOSE: UiMotionSpec = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: { opacity: 0, scale: 0.96, y: 8 },
  durationMs: 155,
  ease: DIALOG_EXIT_EASE,
  originX: 0.5,
  originY: 0.5,
};

export function dialogBackdropMotion(closing: boolean): UiMotionSpec {
  return closing ? BACKDROP_MOTION_CLOSE : BACKDROP_MOTION_OPEN;
}

export function dialogPanelMotion(closing: boolean): UiMotionSpec {
  return closing ? PANEL_MOTION_CLOSE : PANEL_MOTION_OPEN;
}
