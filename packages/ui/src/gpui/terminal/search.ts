/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { TerminalSearchOptions } from '@haus/core/transport';
import type { IBuffer } from '@xterm/headless';

export interface BufferCellPos {
  readonly line: number;
  readonly col: number;
}

export interface BufferSelection {
  readonly start: BufferCellPos;
  readonly end: BufferCellPos;
}

export interface BufferSearchMatch {
  readonly line: number;
  readonly startCol: number;
  readonly length: number;
}

export interface BufferSearchResult {
  readonly matches: readonly BufferSearchMatch[];
  readonly error?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeSelection(sel: BufferSelection): BufferSelection {
  if (
    sel.start.line > sel.end.line ||
    (sel.start.line === sel.end.line && sel.start.col > sel.end.col)
  ) {
    return { start: sel.end, end: sel.start };
  }
  return sel;
}

export function isCellSelected(
  line: number,
  col: number,
  selection: BufferSelection | null,
): boolean {
  if (!selection) return false;
  const { start, end } = normalizeSelection(selection);
  if (line < start.line || line > end.line) return false;
  if (start.line === end.line) return col >= start.col && col <= end.col;
  if (line === start.line) return col >= start.col;
  if (line === end.line) return col <= end.col;
  return true;
}

export function extractSelectionText(buffer: IBuffer, selection: BufferSelection | null): string {
  if (!selection) return '';
  const { start, end } = normalizeSelection(selection);
  const out: string[] = [];
  for (let row = start.line; row <= end.line; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    const fromCol = row === start.line ? start.col : 0;
    const toCol = row === end.line ? end.col + 1 : undefined;
    const slice = line.translateToString(true, fromCol, toCol);
    if (row > start.line && line.isWrapped && out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]}${slice}`;
    } else {
      out.push(slice);
    }
  }
  return out.join('\n');
}

export function extractPlainText(buffer: IBuffer): string {
  const lines: string[] = [];
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    const text = line.translateToString(true);
    if (row > 0 && line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}${text}`;
    } else {
      lines.push(text);
    }
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

export function searchBufferLines(
  buffer: IBuffer,
  query: string,
  options: TerminalSearchOptions,
  limit = 1000,
): BufferSearchResult {
  if (!query) return { matches: [] };
  let pattern = options.regex ? query : escapeRegExp(query);
  if (options.wholeWord) pattern = `\\b(?:${pattern})\\b`;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');
  } catch (err: unknown) {
    return {
      matches: [],
      error: err instanceof Error ? err.message : 'Invalid regular expression',
    };
  }

  const matches: BufferSearchMatch[] = [];
  for (let row = 0; row < buffer.length && matches.length < limit; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    const text = line.translateToString(true);
    if (!text) continue;
    regex.lastIndex = 0;
    let match = regex.exec(text);
    while (match && matches.length < limit) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      } else {
        matches.push({
          line: row,
          startCol: match.index,
          length: match[0].length,
        });
      }
      match = regex.exec(text);
    }
  }
  return { matches };
}

export function selectWordAt(buffer: IBuffer, pos: BufferCellPos): BufferSelection | null {
  const line = buffer.getLine(pos.line);
  if (!line) return null;
  const text = line.translateToString(true);
  if (!text || pos.col >= text.length) return null;
  const isWord = (ch: string) => /[\w./:@-]/.test(ch);
  if (!isWord(text[pos.col] ?? '')) return { start: pos, end: pos };
  let startCol = pos.col;
  let endCol = pos.col;
  while (startCol > 0 && isWord(text[startCol - 1] ?? '')) startCol--;
  while (endCol + 1 < text.length && isWord(text[endCol + 1] ?? '')) endCol++;
  return {
    start: { line: pos.line, col: startCol },
    end: { line: pos.line, col: endCol },
  };
}
