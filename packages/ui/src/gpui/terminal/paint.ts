/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';
import type { IBufferCell, Terminal as XtermTerminalType } from '@xterm/headless';
import { isCellSelected, type BufferSearchMatch, type BufferSelection } from './search.js';
import { resolvePaletteIndex, rgbIntToCss, type TerminalPalette } from './theme.js';

export const TERMINAL_FONT_FAMILY =
  '"SF Mono", ".SF NS Mono", Menlo, "FiraCode Nerd Font Mono", Consolas, monospace';
export const TERMINAL_FONT_SIZE = 13;
export const TERMINAL_LINE_HEIGHT = 1.2;
export const TERMINAL_PADDING_X = 12;
export const TERMINAL_PADDING_Y = 10;
export const TERMINAL_DPR = 2;

export interface TerminalPaintParams {
  readonly ctx: SKRSContext2D;
  readonly term: XtermTerminalType;
  readonly palette: TerminalPalette;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly topLine: number;
  readonly scrollOffsetFromBottom: number;
  readonly readOnly: boolean;
  readonly focused: boolean;
  readonly cursorBlinkOn: boolean;
  readonly selection: BufferSelection | null;
  readonly searchMatches: readonly BufferSearchMatch[];
  readonly activeMatchIndex: number;
}

type IndexedMatch = { readonly match: BufferSearchMatch; readonly active: boolean };

function resolveFg(cell: IBufferCell, palette: TerminalPalette): string {
  if (cell.isFgDefault()) return palette.foreground;
  if (cell.isFgRGB()) return rgbIntToCss(cell.getFgColor());
  if (cell.isFgPalette()) return resolvePaletteIndex(cell.getFgColor(), palette);
  return palette.foreground;
}

function resolveBg(cell: IBufferCell, palette: TerminalPalette): string | null {
  if (cell.isBgDefault()) return null;
  if (cell.isBgRGB()) return rgbIntToCss(cell.getBgColor());
  if (cell.isBgPalette()) return resolvePaletteIndex(cell.getBgColor(), palette);
  return null;
}

function indexVisibleMatches(
  searchMatches: readonly BufferSearchMatch[],
  activeMatchIndex: number,
  startLine: number,
  endLine: number,
): Map<number, IndexedMatch[]> {
  const map = new Map<number, IndexedMatch[]>();
  for (let i = 0; i < searchMatches.length; i++) {
    const match = searchMatches[i];
    if (!match || match.line < startLine || match.line > endLine) continue;
    let bucket = map.get(match.line);
    if (!bucket) {
      bucket = [];
      map.set(match.line, bucket);
    }
    bucket.push({ match, active: i === activeMatchIndex });
  }
  return map;
}

function matchKindAt(entries: IndexedMatch[] | undefined, col: number): 'active' | 'match' | null {
  if (!entries) return null;
  let found: 'active' | 'match' | null = null;
  for (const entry of entries) {
    if (col >= entry.match.startCol && col < entry.match.startCol + entry.match.length) {
      if (entry.active) return 'active';
      found = 'match';
    }
  }
  return found;
}

/** Paints the visible xterm cell grid, search highlights, selection, cursor, and scrollbar. */
export function paintTerminalViewport(p: TerminalPaintParams): void {
  const { ctx, term, palette, cellWidth, cellHeight, topLine } = p;
  const buf = term.buffer.active;
  const rows = term.rows;
  const cols = term.cols;

  ctx.save();
  ctx.setTransform(TERMINAL_DPR, 0, 0, TERMINAL_DPR, 0, 0);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, p.cssWidth, p.cssHeight);

  const reusableCell = buf.getNullCell();
  const matchesByLine = indexVisibleMatches(
    p.searchMatches,
    p.activeMatchIndex,
    topLine,
    topLine + rows - 1,
  );

  for (let r = 0; r < rows; r++) {
    const bufRow = topLine + r;
    const line = buf.getLine(bufRow);
    if (!line) continue;
    const y = TERMINAL_PADDING_Y + r * cellHeight;
    const lineMatches = matchesByLine.get(bufRow);

    // Paint search match spans cleanly as continuous rounded boxes before glyphs.
    if (lineMatches) {
      for (const entry of lineMatches) {
        const startCol = Math.max(0, entry.match.startCol);
        const endCol = Math.min(cols, entry.match.startCol + entry.match.length);
        if (endCol <= startCol) continue;
        const mx = TERMINAL_PADDING_X + startCol * cellWidth;
        const mw = (endCol - startCol) * cellWidth;
        ctx.fillStyle = entry.active ? palette.activeMatchBackground : palette.matchBackground;
        ctx.fillRect(mx, y, mw, cellHeight);
        if (!entry.active) {
          ctx.strokeStyle = palette.matchBorder;
          ctx.lineWidth = 1;
          ctx.strokeRect(mx + 0.5, y + 0.5, Math.max(1, mw - 1), cellHeight - 1);
        }
      }
    }

    for (let c = 0; c < cols; c++) {
      const cell = line.getCell(c, reusableCell);
      if (!cell) continue;
      const width = cell.getWidth();
      if (width === 0) continue;
      const x = TERMINAL_PADDING_X + c * cellWidth;
      const spanW = cellWidth * width;

      let fg = resolveFg(cell, palette);
      let bg = resolveBg(cell, palette);
      if (cell.isInverse()) {
        const prevFg = fg;
        fg = bg ?? palette.background;
        bg = prevFg;
      }

      const matchKind = matchKindAt(lineMatches, c);
      if (matchKind === 'active') {
        bg = null;
        fg = palette.activeMatchForeground;
      } else if (matchKind === 'match') {
        bg = null;
      }

      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, spanW + 0.5, cellHeight + 0.5);
      }
      if (isCellSelected(bufRow, c, p.selection)) {
        ctx.fillStyle = palette.selectionBackground;
        ctx.fillRect(x, y, spanW + 0.5, cellHeight + 0.5);
      }

      if (cell.isInvisible()) continue;
      const chars = cell.getChars();
      if (chars && chars !== ' ') {
        const bold = cell.isBold() ? '600 ' : '400 ';
        const italic = cell.isItalic() ? 'italic ' : '';
        ctx.font = `${italic}${bold}${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`;
        ctx.fillStyle = fg;
        ctx.globalAlpha = cell.isDim() ? 0.6 : 1;
        ctx.fillText(chars, x, Math.round(y + cellHeight * 0.78));
        ctx.globalAlpha = 1;
      }

      if (cell.isUnderline()) {
        ctx.fillStyle = fg;
        ctx.fillRect(x, y + cellHeight - 2, spanW, 1);
      }
      if (cell.isStrikethrough()) {
        ctx.fillStyle = fg;
        ctx.fillRect(x, Math.round(y + cellHeight * 0.52), spanW, 1);
      }
    }
  }

  // Cursor (bar when focused, outline when inactive — matching Electron LiveTerminal)
  if (!p.readOnly && p.scrollOffsetFromBottom === 0) {
    const visRow = buf.baseY + buf.cursorY - topLine;
    if (visRow >= 0 && visRow < rows) {
      const x = TERMINAL_PADDING_X + Math.min(buf.cursorX, cols - 1) * cellWidth;
      const y = TERMINAL_PADDING_Y + visRow * cellHeight;
      if (p.focused) {
        if (p.cursorBlinkOn) {
          ctx.fillStyle = palette.cursor;
          ctx.fillRect(Math.round(x), y + 1, 2, cellHeight - 2);
        }
      } else {
        ctx.strokeStyle = palette.cursor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.strokeRect(Math.round(x) + 0.5, y + 1.5, Math.round(cellWidth) - 1, cellHeight - 3);
        ctx.globalAlpha = 1;
      }
    }
  }

  // Subtle scrollback thumb
  if (buf.baseY > 0) {
    const totalLines = buf.baseY + rows;
    const trackH = Math.max(24, p.cssHeight - TERMINAL_PADDING_Y * 2);
    const thumbH = Math.max(20, Math.round((rows / totalLines) * trackH));
    const ratio = (buf.baseY - p.scrollOffsetFromBottom) / buf.baseY;
    const thumbY = TERMINAL_PADDING_Y + Math.round(ratio * (trackH - thumbH));
    ctx.fillStyle = palette.scrollbarThumb;
    ctx.fillRect(p.cssWidth - 6, thumbY, 3, thumbH);
  }

  ctx.restore();
}
