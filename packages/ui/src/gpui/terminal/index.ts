/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export { GpuiXtermEngine, type GpuiXtermEngineOptions } from './engine.js';
export {
  encodeBracketedPaste,
  encodeTerminalKeyEvent,
  type TerminalKeyInput,
  type TerminalKeyModes,
  type TerminalKeyOutcome,
} from './keymap.js';
export {
  extractPlainText,
  extractSelectionText,
  isCellSelected,
  normalizeSelection,
  searchBufferLines,
  selectWordAt,
  type BufferCellPos,
  type BufferSearchMatch,
  type BufferSearchResult,
  type BufferSelection,
} from './search.js';
export { GpuiXtermTerminal, type GpuiXtermHandle, type GpuiXtermTerminalProps } from './surface.js';
export {
  resolvePaletteIndex,
  resolveTerminalPalette,
  rgbIntToCss,
  type TerminalPalette,
} from './theme.js';
