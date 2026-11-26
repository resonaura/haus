/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { TerminalSearchOptions } from '@haus/core/transport';
import type { SKRSContext2D } from '@napi-rs/canvas';
import xtermPkg from '@xterm/headless';
import type { Terminal as XtermTerminalType } from '@xterm/headless';
import type { GpuiCanvasElement } from '../canvas/element.js';
import {
  paintTerminalViewport,
  TERMINAL_DPR,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_PADDING_X,
  TERMINAL_PADDING_Y,
} from './paint.js';
import {
  extractPlainText,
  extractSelectionText,
  searchBufferLines,
  selectWordAt,
  type BufferCellPos,
  type BufferSearchMatch,
  type BufferSelection,
} from './search.js';
import { resolveTerminalPalette, type TerminalPalette } from './theme.js';

export interface GpuiXtermEngineOptions {
  readonly readOnly: boolean;
  readonly themeMode: 'dark' | 'light';
  readonly convertEol?: boolean;
  readonly onGeometry?: (geometry: { readonly cols: number; readonly rows: number }) => void;
}

/**
 * Real `@xterm/headless` VT100/xterm-256color/truecolor terminal emulator rendered at Retina
 * resolution onto a GPUI Skia `<GpuiCanvas />` (`CanvasRenderingContext2D`).
 */
export class GpuiXtermEngine {
  readonly term: XtermTerminalType;
  private canvas: GpuiCanvasElement | null = null;
  private ctx: SKRSContext2D | null = null;
  private palette: TerminalPalette;
  private readonly readOnly: boolean;
  private readonly onGeometry?: (geometry: {
    readonly cols: number;
    readonly rows: number;
  }) => void;
  private cellWidth = 7.8;
  private cellHeight = Math.ceil(TERMINAL_FONT_SIZE * TERMINAL_LINE_HEIGHT);
  private cssWidth = 640;
  private cssHeight = 360;
  private scrollOffsetFromBottom = 0;
  private focused = false;
  private cursorBlinkOn = true;
  private selection: BufferSelection | null = null;
  private searchMatches: readonly BufferSearchMatch[] = [];
  private activeMatchIndex = -1;
  private renderScheduled = false;
  private disposed = false;

  constructor(options: GpuiXtermEngineOptions) {
    this.readOnly = options.readOnly;
    this.palette = resolveTerminalPalette(options.themeMode);
    this.onGeometry = options.onGeometry;
    const { Terminal } = xtermPkg;
    this.term = new Terminal({
      allowProposedApi: true,
      cols: 80,
      rows: 22,
      scrollback: options.readOnly ? 5000 : 3000,
      convertEol: options.convertEol ?? options.readOnly,
      disableStdin: options.readOnly,
      drawBoldTextInBrightColors: false,
    });
  }

  attachCanvas(canvas: GpuiCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    if (this.ctx) {
      this.measureCellMetrics(this.ctx);
      this.fitToPixels(this.cssWidth, this.cssHeight);
    }
  }

  setThemeMode(mode: 'dark' | 'light'): void {
    this.palette = resolveTerminalPalette(mode);
    this.scheduleRender();
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.cursorBlinkOn = true;
    this.scheduleRender();
  }

  toggleCursorBlink(): void {
    if (!this.focused || this.readOnly) return;
    this.cursorBlinkOn = !this.cursorBlinkOn;
    this.scheduleRender();
  }

  resetCursorBlink(): void {
    if (this.cursorBlinkOn) return;
    this.cursorBlinkOn = true;
    this.scheduleRender();
  }

  getGeometry(): { readonly cols: number; readonly rows: number } {
    return { cols: this.term.cols, rows: this.term.rows };
  }

  fitToPixels(
    cssWidth: number,
    cssHeight: number,
  ): { readonly cols: number; readonly rows: number } {
    if (this.disposed) return this.getGeometry();
    const w = Math.max(120, Math.round(cssWidth));
    const h = Math.max(80, Math.round(cssHeight));
    this.cssWidth = w;
    this.cssHeight = h;

    const cols = Math.max(
      20,
      Math.min(500, Math.floor((w - TERMINAL_PADDING_X * 2) / this.cellWidth)),
    );
    const rows = Math.max(
      4,
      Math.min(300, Math.floor((h - TERMINAL_PADDING_Y * 2) / this.cellHeight)),
    );

    if (this.canvas) {
      const targetW = Math.round(w * TERMINAL_DPR);
      const targetH = Math.round(h * TERMINAL_DPR);
      if (this.canvas.width !== targetW) this.canvas.width = targetW;
      if (this.canvas.height !== targetH) this.canvas.height = targetH;
      this.ctx = this.canvas.getContext('2d');
    }

    if (cols !== this.term.cols || rows !== this.term.rows) {
      this.term.resize(cols, rows);
      this.clampScroll();
    }
    this.onGeometry?.({ cols, rows });
    this.renderNow();
    return { cols, rows };
  }

  write(data: string | Uint8Array, onWritten?: () => void): void {
    if (this.disposed) return;
    const wasAtBottom = this.scrollOffsetFromBottom === 0;
    this.cursorBlinkOn = true;
    this.term.write(data, () => {
      if (this.disposed) return;
      if (wasAtBottom) this.scrollOffsetFromBottom = 0;
      else this.clampScroll();
      this.scheduleRender();
      onWritten?.();
    });
  }

  writeln(text: string): void {
    this.write(`${text}\r\n`);
  }

  clear(): void {
    if (this.disposed) return;
    this.term.clear();
    this.scrollOffsetFromBottom = 0;
    this.selection = null;
    this.scheduleRender();
  }

  reset(): void {
    if (this.disposed) return;
    this.term.reset();
    this.scrollOffsetFromBottom = 0;
    this.selection = null;
    this.searchMatches = [];
    this.activeMatchIndex = -1;
    this.scheduleRender();
  }

  scrollLines(deltaLines: number): void {
    if (this.disposed || deltaLines === 0) return;
    const maxScroll = this.term.buffer.active.baseY;
    const next = Math.max(0, Math.min(maxScroll, this.scrollOffsetFromBottom + deltaLines));
    if (next === this.scrollOffsetFromBottom) return;
    this.scrollOffsetFromBottom = next;
    this.scheduleRender();
  }

  scrollToBottom(): void {
    if (this.scrollOffsetFromBottom === 0) return;
    this.scrollOffsetFromBottom = 0;
    this.scheduleRender();
  }

  pixelToCell(localX: number, localY: number): BufferCellPos {
    const col = Math.max(
      0,
      Math.min(this.term.cols - 1, Math.floor((localX - TERMINAL_PADDING_X) / this.cellWidth)),
    );
    const visRow = Math.max(
      0,
      Math.min(this.term.rows - 1, Math.floor((localY - TERMINAL_PADDING_Y) / this.cellHeight)),
    );
    return { line: this.viewportTopLine() + visRow, col };
  }

  setSelection(selection: BufferSelection | null): void {
    this.selection = selection;
    this.scheduleRender();
  }

  selectWord(pos: BufferCellPos): void {
    this.selection = selectWordAt(this.term.buffer.active, pos);
    this.scheduleRender();
  }

  selectLine(lineIndex: number): void {
    this.selection = {
      start: { line: lineIndex, col: 0 },
      end: { line: lineIndex, col: Math.max(0, this.term.cols - 1) },
    };
    this.scheduleRender();
  }

  selectAll(): void {
    const buf = this.term.buffer.active;
    if (buf.length <= 0) return;
    this.selection = {
      start: { line: 0, col: 0 },
      end: { line: buf.length - 1, col: Math.max(0, this.term.cols - 1) },
    };
    this.scheduleRender();
  }

  hasSelection(): boolean {
    return this.selection !== null;
  }

  getSelection(): string {
    return extractSelectionText(this.term.buffer.active, this.selection);
  }

  getPlainText(): string {
    return extractPlainText(this.term.buffer.active);
  }

  search(
    query: string,
    options: TerminalSearchOptions,
  ): { readonly resultIndex: number; readonly resultCount: number; readonly error?: string } {
    const found = searchBufferLines(this.term.buffer.active, query, options);
    this.searchMatches = found.matches;
    this.activeMatchIndex = found.matches.length > 0 ? 0 : -1;
    if (this.activeMatchIndex >= 0) this.scrollMatchIntoView(this.activeMatchIndex);
    this.scheduleRender();
    return {
      resultIndex: this.activeMatchIndex,
      resultCount: found.matches.length,
      error: found.error,
    };
  }

  findStep(backward: boolean): { readonly resultIndex: number; readonly resultCount: number } {
    const count = this.searchMatches.length;
    if (count === 0) return { resultIndex: -1, resultCount: 0 };
    const next =
      this.activeMatchIndex < 0
        ? backward
          ? count - 1
          : 0
        : (this.activeMatchIndex + (backward ? -1 : 1) + count) % count;
    this.activeMatchIndex = next;
    this.scrollMatchIntoView(next);
    this.scheduleRender();
    return { resultIndex: next, resultCount: count };
  }

  clearSearch(): void {
    if (this.searchMatches.length === 0 && this.activeMatchIndex === -1) return;
    this.searchMatches = [];
    this.activeMatchIndex = -1;
    this.scheduleRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas = null;
    this.ctx = null;
    this.term.dispose();
  }

  renderNow(): void {
    if (this.disposed || !this.ctx || !this.canvas) return;
    paintTerminalViewport({
      ctx: this.ctx,
      term: this.term,
      palette: this.palette,
      cssWidth: this.cssWidth,
      cssHeight: this.cssHeight,
      cellWidth: this.cellWidth,
      cellHeight: this.cellHeight,
      topLine: this.viewportTopLine(),
      scrollOffsetFromBottom: this.scrollOffsetFromBottom,
      readOnly: this.readOnly,
      focused: this.focused,
      cursorBlinkOn: this.cursorBlinkOn,
      selection: this.selection,
      searchMatches: this.searchMatches,
      activeMatchIndex: this.activeMatchIndex,
    });
    this.canvas.flush();
  }

  private viewportTopLine(): number {
    return Math.max(0, this.term.buffer.active.baseY - this.scrollOffsetFromBottom);
  }

  private clampScroll(): void {
    const maxScroll = this.term.buffer.active.baseY;
    if (this.scrollOffsetFromBottom > maxScroll) this.scrollOffsetFromBottom = maxScroll;
  }

  private scrollMatchIntoView(index: number): void {
    const match = this.searchMatches[index];
    if (!match) return;
    const baseY = this.term.buffer.active.baseY;
    const desiredTop = Math.max(0, Math.min(baseY, match.line - Math.floor(this.term.rows / 3)));
    this.scrollOffsetFromBottom = Math.max(0, baseY - desiredTop);
  }

  private measureCellMetrics(ctx: SKRSContext2D): void {
    ctx.font = `400 ${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`;
    const sample = ctx.measureText('MMMMMMMMMM').width / 10;
    if (Number.isFinite(sample) && sample > 3 && sample < 24) {
      this.cellWidth = Math.ceil(sample * TERMINAL_DPR) / TERMINAL_DPR;
    }
    this.cellHeight = Math.ceil(TERMINAL_FONT_SIZE * TERMINAL_LINE_HEIGHT);
  }

  private scheduleRender(): void {
    if (this.disposed || this.renderScheduled) return;
    this.renderScheduled = true;
    queueMicrotask(() => {
      this.renderScheduled = false;
      if (!this.disposed) this.renderNow();
    });
  }
}
