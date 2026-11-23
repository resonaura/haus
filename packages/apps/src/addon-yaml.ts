/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

function stripInlineComment(raw: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < raw.length) {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]!))) {
      return raw.slice(0, i).trimEnd();
    }
  }
  return raw.trimEnd();
}

function splitTopLevel(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < input.length) {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[' || ch === '{') {
      depth += 1;
    } else if (ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (ch === delimiter && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

function findKeyValueColon(text: string): number {
  let quote: '"' | "'" | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < text.length) {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[' || ch === '{') {
      depth += 1;
    } else if (ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ':' && depth === 0) {
      const next = text[i + 1];
      if (next === undefined || next === ' ' || next === '\t') {
        return i;
      }
    }
  }
  return -1;
}

function unquoteKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return String(JSON.parse(trimmed));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === '[]') return [];
  if (trimmed === '{}') return {};
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner, ',').map((part) => parseScalar(part));
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return {};
    const obj: Record<string, unknown> = {};
    for (const part of splitTopLevel(inner, ',')) {
      const colon = findKeyValueColon(part);
      if (colon <= 0) continue;
      const key = unquoteKey(part.slice(0, colon));
      const val = part.slice(colon + 1).trim();
      obj[key] = parseScalar(val);
    }
    return obj;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }
  return trimmed;
}

function tokenizeYaml(source: string): YamlLine[] {
  const out: YamlLine[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const expanded = rawLine.replace(/\t/g, '  ');
    const stripped = stripInlineComment(expanded);
    if (!stripped.trim() || stripped.trim() === '---' || stripped.trim() === '...') continue;
    const indent = stripped.length - stripped.trimStart().length;
    out.push({ indent, text: stripped.trim() });
  }
  return out;
}

function parseBlock(
  lines: readonly YamlLine[],
  startIndex: number,
  minIndent: number,
): { readonly value: unknown; readonly nextIndex: number } {
  if (startIndex >= lines.length) {
    return { value: null, nextIndex: startIndex };
  }
  const first = lines[startIndex]!;
  if (first.indent < minIndent) {
    return { value: null, nextIndex: startIndex };
  }
  if (first.text === '-' || first.text.startsWith('- ')) {
    return parseSequence(lines, startIndex, first.indent);
  }
  if (findKeyValueColon(first.text) >= 0) {
    return parseMapping(lines, startIndex, first.indent);
  }
  return { value: parseScalar(first.text), nextIndex: startIndex + 1 };
}

function parseSequence(
  lines: readonly YamlLine[],
  startIndex: number,
  baseIndent: number,
): { readonly value: unknown[]; readonly nextIndex: number } {
  const list: unknown[] = [];
  let idx = startIndex;
  while (idx < lines.length) {
    const line = lines[idx]!;
    if (line.indent < baseIndent) break;
    if (line.indent > baseIndent) break;
    if (line.text !== '-' && !line.text.startsWith('- ')) break;

    const rest = line.text === '-' ? '' : line.text.slice(2).trim();
    idx += 1;
    if (!rest) {
      if (idx < lines.length && lines[idx]!.indent > baseIndent) {
        const nested = parseBlock(lines, idx, lines[idx]!.indent);
        list.push(nested.value);
        idx = nested.nextIndex;
      } else {
        list.push(null);
      }
      continue;
    }

    const colon = findKeyValueColon(rest);
    if (colon >= 0) {
      const obj: Record<string, unknown> = {};
      const key = unquoteKey(rest.slice(0, colon));
      const valText = rest.slice(colon + 1).trim();
      const entryIndent = baseIndent + 2;
      if (valText && valText !== '|' && valText !== '>') {
        obj[key] = parseScalar(valText);
      } else if (idx < lines.length && lines[idx]!.indent > entryIndent) {
        const nested = parseBlock(lines, idx, lines[idx]!.indent);
        obj[key] = nested.value;
        idx = nested.nextIndex;
      } else {
        obj[key] = null;
      }
      while (idx < lines.length && lines[idx]!.indent >= entryIndent) {
        const sub = lines[idx]!;
        if (sub.indent > entryIndent) break;
        const subColon = findKeyValueColon(sub.text);
        if (subColon < 0) break;
        const subKey = unquoteKey(sub.text.slice(0, subColon));
        const subVal = sub.text.slice(subColon + 1).trim();
        idx += 1;
        if (subVal && subVal !== '|' && subVal !== '>') {
          obj[subKey] = parseScalar(subVal);
        } else if (idx < lines.length && lines[idx]!.indent > sub.indent) {
          const nested = parseBlock(lines, idx, lines[idx]!.indent);
          obj[subKey] = nested.value;
          idx = nested.nextIndex;
        } else {
          obj[subKey] = null;
        }
      }
      list.push(obj);
      continue;
    }

    list.push(parseScalar(rest));
  }
  return { value: list, nextIndex: idx };
}

function parseMapping(
  lines: readonly YamlLine[],
  startIndex: number,
  baseIndent: number,
): { readonly value: Record<string, unknown>; readonly nextIndex: number } {
  const obj: Record<string, unknown> = {};
  let idx = startIndex;
  while (idx < lines.length) {
    const line = lines[idx]!;
    if (line.indent < baseIndent) break;
    if (line.indent > baseIndent) {
      idx += 1;
      continue;
    }
    const colon = findKeyValueColon(line.text);
    if (colon < 0) break;

    const key = unquoteKey(line.text.slice(0, colon));
    const valText = line.text.slice(colon + 1).trim();
    idx += 1;

    if (
      valText === '|' ||
      valText === '|- ' ||
      valText === '|-' ||
      valText === '>' ||
      valText === '>-'
    ) {
      const collected: string[] = [];
      const blockMin = baseIndent + 1;
      while (idx < lines.length && lines[idx]!.indent >= blockMin) {
        collected.push(lines[idx]!.text);
        idx += 1;
      }
      obj[key] = valText.startsWith('>') ? collected.join(' ') : collected.join('\n');
      continue;
    }

    if (valText) {
      obj[key] = parseScalar(valText);
      continue;
    }

    if (idx < lines.length) {
      const next = lines[idx]!;
      const isSameIndentSeq =
        next.indent === baseIndent && (next.text === '-' || next.text.startsWith('- '));
      if (next.indent > baseIndent || isSameIndentSeq) {
        const nested = parseBlock(lines, idx, next.indent);
        obj[key] = nested.value;
        idx = nested.nextIndex;
        continue;
      }
    }
    obj[key] = null;
  }
  return { value: obj, nextIndex: idx };
}

/** Parses Home Assistant YAML or JSON configuration text into a plain JavaScript object. */
export function parseHaConfigDocument(
  rawText: string,
  fileName = 'config.yaml',
): Record<string, unknown> {
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error('empty_config_document');
  if (fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('invalid_json_config');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config_must_be_object');
    }
    return parsed as Record<string, unknown>;
  }
  const lines = tokenizeYaml(rawText);
  if (lines.length === 0) throw new Error('empty_config_document');
  const { value } = parseBlock(lines, 0, lines[0]!.indent);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('config_must_be_object');
  }
  return value as Record<string, unknown>;
}
