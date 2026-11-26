/* @jsxImportSource @gpuix/react */
/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import type { TerminalSearchOptions } from '@haus/core/transport';
import type { EventPayload, KeyEvent, StyleDesc } from '@gpuix/react';
import { useGpuix } from '@gpuix/react';
import { useHausUi } from '../../primitives/index.js';
import type { GpuiCanvasElement } from '../canvas/element.js';
import { GpuiCanvas } from '../canvas/surface.js';
import { GpuiXtermEngine } from './engine.js';
import { encodeBracketedPaste, encodeTerminalKeyEvent } from './keymap.js';
import type { BufferCellPos } from './search.js';

export interface GpuiXtermHandle {
  write(data: string | Uint8Array, onWritten?: () => void): void;
  writeln(text: string): void;
  clear(): void;
  reset(): void;
  getGeometry(): { readonly cols: number; readonly rows: number };
  getSelection(): string;
  getPlainText(): string;
  search(
    query: string,
    options: TerminalSearchOptions,
  ): { readonly resultIndex: number; readonly resultCount: number; readonly error?: string };
  findNext(): { readonly resultIndex: number; readonly resultCount: number };
  findPrevious(): { readonly resultIndex: number; readonly resultCount: number };
  clearSearch(): void;
}

export interface GpuiXtermTerminalProps {
  readonly id?: string;
  readonly terminalRef?: Ref<GpuiXtermHandle>;
  readonly readOnly?: boolean;
  readonly convertEol?: boolean;
  readonly autoFocus?: boolean;
  readonly style?: StyleDesc;
  readonly onData?: (data: string) => void;
  readonly onResize?: (geometry: { readonly cols: number; readonly rows: number }) => void;
  readonly onOpenSearch?: () => void;
  readonly onCopyText?: (text: string) => void;
}

function isMacRuntime(): boolean {
  const proc = (globalThis as { readonly process?: { readonly platform?: string } }).process;
  return proc?.platform === 'darwin';
}

/**
 * Interactive GPUIX xterm.js terminal surface (`@xterm/headless`) rendered at Retina resolution
 * on `<GpuiCanvas />` with ANSI 16/256/truecolor, cursor blink, mouse selection, wheel scrollback,
 * keyboard VT100 encoding, clipboard copy/paste, and search match highlights.
 */
export function GpuiXtermTerminal({
  id = 'server-terminal-xterm',
  terminalRef,
  readOnly = false,
  convertEol,
  autoFocus,
  style,
  onData,
  onResize,
  onOpenSearch,
  onCopyText,
}: GpuiXtermTerminalProps) {
  const { theme } = useHausUi();
  const { renderer } = useGpuix();
  const canvasRef = useRef<GpuiCanvasElement | null>(null);
  const engineRef = useRef<GpuiXtermEngine | null>(null);
  const draggingAnchorRef = useRef<BufferCellPos | null>(null);
  const wheelRemainderRef = useRef(0);

  const callbacksRef = useRef({ onData, onResize, onOpenSearch, onCopyText });
  callbacksRef.current = { onData, onResize, onOpenSearch, onCopyText };

  if (!engineRef.current) {
    engineRef.current = new GpuiXtermEngine({
      readOnly,
      themeMode: theme.mode,
      convertEol,
      onGeometry: (geometry) => callbacksRef.current.onResize?.(geometry),
    });
  }

  useEffect(() => {
    engineRef.current?.setThemeMode(theme.mode);
  }, [theme.mode]);

  useLayoutEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.attachCanvas(canvasRef.current);
    return () => engine.attachCanvas(null);
  }, []);

  useEffect(() => {
    if (readOnly) return;
    const timer = setInterval(() => engineRef.current?.toggleCursorBlink(), 530);
    return () => clearInterval(timer);
  }, [readOnly]);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  useImperativeHandle(
    terminalRef,
    () => ({
      write: (data, onWritten) => engineRef.current?.write(data, onWritten),
      writeln: (text) => engineRef.current?.writeln(text),
      clear: () => engineRef.current?.clear(),
      reset: () => engineRef.current?.reset(),
      getGeometry: () => engineRef.current?.getGeometry() ?? { cols: 80, rows: 22 },
      getSelection: () => engineRef.current?.getSelection() ?? '',
      getPlainText: () => engineRef.current?.getPlainText() ?? '',
      search: (query, options) =>
        engineRef.current?.search(query, options) ?? { resultIndex: -1, resultCount: 0 },
      findNext: () => engineRef.current?.findStep(false) ?? { resultIndex: -1, resultCount: 0 },
      findPrevious: () => engineRef.current?.findStep(true) ?? { resultIndex: -1, resultCount: 0 },
      clearSearch: () => engineRef.current?.clearSearch(),
    }),
    [],
  );

  const copySelection = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const text = engine.getSelection();
    if (!text) return;
    renderer?.writeToClipboard?.(text);
    callbacksRef.current.onCopyText?.(text);
  };

  const handleKeyDown = (event: KeyEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    const outcome = encodeTerminalKeyEvent(
      {
        key: event.key ?? '',
        keyChar: event.keyChar,
        ctrl: event.modifiers?.ctrl ?? false,
        alt: event.modifiers?.alt ?? false,
        shift: event.modifiers?.shift ?? false,
        cmd: event.modifiers?.cmd ?? false,
      },
      {
        applicationCursorKeysMode: engine.term.modes.applicationCursorKeysMode,
        hasSelection: engine.hasSelection(),
        isMac: isMacRuntime(),
      },
    );

    if (outcome.kind === 'ignore') return;
    event.preventDefault();
    event.stopPropagation();

    if (outcome.kind === 'action') {
      if (outcome.action === 'search') callbacksRef.current.onOpenSearch?.();
      else if (outcome.action === 'copy') copySelection();
      else if (outcome.action === 'clear') engine.clear();
      else if (outcome.action === 'select-all') engine.selectAll();
      else if (outcome.action === 'paste' && !readOnly) {
        const text = renderer?.readFromClipboard?.() ?? '';
        if (text) {
          engine.scrollToBottom();
          callbacksRef.current.onData?.(
            encodeBracketedPaste(text, engine.term.modes.bracketedPasteMode),
          );
        }
      }
      return;
    }

    if (readOnly) return;
    engine.setSelection(null);
    engine.scrollToBottom();
    engine.resetCursorBlink();
    callbacksRef.current.onData?.(outcome.data);
  };

  const handlePointerDown = (event: EventPayload) => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas || event.x === undefined || event.y === undefined) return;
    if (event.button && event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const pos = engine.pixelToCell(event.x - rect.left, event.y - rect.top);
    if (event.clickCount === 3) {
      draggingAnchorRef.current = null;
      engine.selectLine(pos.line);
      return;
    }
    if (event.clickCount === 2) {
      draggingAnchorRef.current = null;
      engine.selectWord(pos);
      return;
    }
    draggingAnchorRef.current = pos;
    engine.setSelection(null);
  };

  const handlePointerMove = (event: EventPayload) => {
    const anchor = draggingAnchorRef.current;
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!anchor || !engine || !canvas || event.x === undefined || event.y === undefined) return;
    if (event.pressedButton !== 0) {
      draggingAnchorRef.current = null;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const current = engine.pixelToCell(event.x - rect.left, event.y - rect.top);
    engine.setSelection({ start: anchor, end: current });
  };

  const handlePointerUp = () => {
    draggingAnchorRef.current = null;
  };

  const handleWheel = (event: EventPayload) => {
    const engine = engineRef.current;
    if (!engine || event.deltaY === undefined) return;
    if (event.precise) {
      wheelRemainderRef.current += event.deltaY;
      const lines = Math.trunc(wheelRemainderRef.current / 16);
      if (lines !== 0) {
        wheelRemainderRef.current -= lines * 16;
        engine.scrollLines(lines);
      }
    } else {
      engine.scrollLines(Math.round(event.deltaY * 3));
    }
  };

  return (
    <GpuiCanvas
      canvas={{
        id,
        canvasRef,
        role: 'textbox',
        tabIndex: 0,
        ariaLabel: readOnly ? 'Live terminal logs' : 'Interactive xterm terminal',
      }}
      autoFocus={autoFocus}
      onLayoutBounds={({ width, height }) => engineRef.current?.fitToPixels(width, height)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onRawKeyDown={handleKeyDown}
      onFocusChange={(focused) => engineRef.current?.setFocused(focused)}
      style={{
        width: '100%',
        height: 440,
        borderRadius: 12,
        backgroundColor: theme.mode === 'dark' ? '#000000' : '#ffffff',
        cursor: 'text',
        ...style,
      }}
    />
  );
}
