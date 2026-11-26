/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface TerminalKeyInput {
  readonly key: string;
  readonly keyChar?: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly cmd: boolean;
}

export interface TerminalKeyModes {
  readonly applicationCursorKeysMode: boolean;
  readonly hasSelection: boolean;
  readonly isMac: boolean;
}

export type TerminalKeyOutcome =
  | {
      readonly kind: 'action';
      readonly action: 'search' | 'copy' | 'paste' | 'clear' | 'select-all';
    }
  | { readonly kind: 'data'; readonly data: string }
  | { readonly kind: 'ignore' };

function xtermModifierCode(input: TerminalKeyInput): number {
  let code = 1;
  if (input.shift) code += 1;
  if (input.alt) code += 2;
  if (input.ctrl) code += 4;
  return code;
}

function encodeCursorKey(
  letter: 'A' | 'B' | 'C' | 'D' | 'H' | 'F',
  input: TerminalKeyInput,
  appMode: boolean,
): string {
  const mod = xtermModifierCode(input);
  if (mod > 1) return `\x1b[1;${mod}${letter}`;
  return appMode ? `\x1bO${letter}` : `\x1b[${letter}`;
}

function encodeTildeKey(code: number, input: TerminalKeyInput): string {
  const mod = xtermModifierCode(input);
  return mod > 1 ? `\x1b[${code};${mod}~` : `\x1b[${code}~`;
}

function encodeFunctionKey(fnNum: number, input: TerminalKeyInput): string {
  const mod = xtermModifierCode(input);
  if (fnNum >= 1 && fnNum <= 4) {
    const suffix = ['P', 'Q', 'R', 'S'][fnNum - 1] ?? 'P';
    return mod > 1 ? `\x1b[1;${mod}${suffix}` : `\x1bO${suffix}`;
  }
  const codes: Record<number, number> = {
    5: 15,
    6: 17,
    7: 18,
    8: 19,
    9: 20,
    10: 21,
    11: 23,
    12: 24,
  };
  return encodeTildeKey(codes[fnNum] ?? 15, input);
}

/** Encodes a GPUIX keyboard event into either a terminal UI shortcut action or VT100/xterm PTY bytes. */
export function encodeTerminalKeyEvent(
  input: TerminalKeyInput,
  modes: TerminalKeyModes,
): TerminalKeyOutcome {
  const rawKey = input.key;
  const key = rawKey.toLowerCase();
  const primaryCmd = modes.isMac ? input.cmd : input.ctrl && input.shift;

  // UI shortcuts (matching Electron's LiveTerminal custom key handler)
  if ((modes.isMac ? input.cmd : input.ctrl) && key === 'f') {
    return { kind: 'action', action: 'search' };
  }
  if (primaryCmd && key === 'c' && modes.hasSelection) {
    return { kind: 'action', action: 'copy' };
  }
  if (modes.isMac && input.cmd && key === 'c') {
    return { kind: 'action', action: 'copy' };
  }
  if ((modes.isMac ? input.cmd : input.ctrl && input.shift) && key === 'v') {
    return { kind: 'action', action: 'paste' };
  }
  if (modes.isMac && input.cmd && key === 'k') {
    return { kind: 'action', action: 'clear' };
  }
  if (modes.isMac && input.cmd && key === 'a') {
    return { kind: 'action', action: 'select-all' };
  }
  // Ignore unrelated Cmd shortcuts on macOS so OS/app chords don't leak characters into the PTY.
  if (modes.isMac && input.cmd) {
    return { kind: 'ignore' };
  }

  // Named control & navigation keys
  switch (key) {
    case 'enter':
    case 'return':
      return { kind: 'data', data: input.alt ? '\x1b\r' : '\r' };
    case 'backspace':
      return { kind: 'data', data: input.alt ? '\x1b\x7f' : '\x7f' };
    case 'tab':
      return { kind: 'data', data: input.shift ? '\x1b[Z' : '\t' };
    case 'escape':
      return { kind: 'data', data: '\x1b' };
    case 'up':
    case 'arrowup':
      return { kind: 'data', data: encodeCursorKey('A', input, modes.applicationCursorKeysMode) };
    case 'down':
    case 'arrowdown':
      return { kind: 'data', data: encodeCursorKey('B', input, modes.applicationCursorKeysMode) };
    case 'right':
    case 'arrowright':
      return { kind: 'data', data: encodeCursorKey('C', input, modes.applicationCursorKeysMode) };
    case 'left':
    case 'arrowleft':
      return { kind: 'data', data: encodeCursorKey('D', input, modes.applicationCursorKeysMode) };
    case 'home':
      return { kind: 'data', data: encodeCursorKey('H', input, modes.applicationCursorKeysMode) };
    case 'end':
      return { kind: 'data', data: encodeCursorKey('F', input, modes.applicationCursorKeysMode) };
    case 'insert':
      return { kind: 'data', data: encodeTildeKey(2, input) };
    case 'delete':
      return { kind: 'data', data: encodeTildeKey(3, input) };
    case 'pageup':
      return { kind: 'data', data: encodeTildeKey(5, input) };
    case 'pagedown':
      return { kind: 'data', data: encodeTildeKey(6, input) };
    case 'space':
      if (input.ctrl) return { kind: 'data', data: '\x00' };
      return { kind: 'data', data: input.alt ? '\x1b ' : ' ' };
    default:
      break;
  }

  const fnMatch = /^f(\d{1,2})$/.exec(key);
  if (fnMatch) {
    const fnNum = Number(fnMatch[1]);
    if (fnNum >= 1 && fnNum <= 12) {
      return { kind: 'data', data: encodeFunctionKey(fnNum, input) };
    }
  }

  // Ctrl+key combinations (Ctrl+A..Z, Ctrl+[ \ ] ^ _)
  if (input.ctrl && !input.cmd) {
    if (key.length === 1) {
      const code = key.charCodeAt(0);
      if (code >= 97 && code <= 122) {
        return { kind: 'data', data: String.fromCharCode(code - 96) };
      }
      if (key === '[') return { kind: 'data', data: '\x1b' };
      if (key === '\\') return { kind: 'data', data: '\x1c' };
      if (key === ']') return { kind: 'data', data: '\x1d' };
      if (key === '^' || key === '6') return { kind: 'data', data: '\x1e' };
      if (key === '_' || key === '-') return { kind: 'data', data: '\x1f' };
      if (key === '@' || key === '2') return { kind: 'data', data: '\x00' };
    }
    return { kind: 'ignore' };
  }

  // Printable character (prefer OS-resolved keyChar for Shift/Unicode/international layouts)
  if (input.keyChar && input.keyChar.length > 0) {
    if (input.alt && !modes.isMac) return { kind: 'data', data: `\x1b${input.keyChar}` };
    return { kind: 'data', data: input.keyChar };
  }

  if (rawKey.length === 1) {
    const ch = input.shift ? rawKey.toUpperCase() : rawKey;
    return { kind: 'data', data: input.alt ? `\x1b${ch}` : ch };
  }

  return { kind: 'ignore' };
}

/** Wraps pasted text in xterm bracketed-paste sequences when enabled by the running program. */
export function encodeBracketedPaste(text: string, bracketedPasteMode: boolean): string {
  const normalized = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
  if (!bracketedPasteMode) return normalized;
  return `\x1b[200~${normalized}\x1b[201~`;
}
