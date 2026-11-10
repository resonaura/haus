/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type CommandTemplateResult =
  { readonly kind: 'value'; readonly payload: string } | { readonly kind: 'unsupported' };

type Scalar = string | number | boolean | null | undefined;

const maximumTemplateLength = 1024;
const maximumPayloadLength = 4096;

function literal(source: string): { matched: true; value: Scalar } | { matched: false } {
  const value = source.trim();
  if (value === 'none' || value === 'None' || value === 'null') {
    return { matched: true, value: null };
  }
  if (value === 'true' || value === 'True') return { matched: true, value: true };
  if (value === 'false' || value === 'False') return { matched: true, value: false };
  if (/^(['"]).*\1$/s.test(value)) {
    const quote = value[0];
    if (!quote) return { matched: false };
    const contents = value.slice(1, -1);
    if (contents.includes('\\') || contents.includes(quote)) return { matched: false };
    return { matched: true, value: contents };
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    const number = Number(value);
    return Number.isFinite(number) ? { matched: true, value: number } : { matched: false };
  }
  return { matched: false };
}

function scalarText(value: Scalar): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return undefined;
}

function rounded(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2;
  const result =
    Math.abs(fraction - 0.5) <= tolerance
      ? lower % 2 === 0
        ? lower
        : lower + 1
      : Math.round(scaled);
  return result / factor;
}

function expression(source: string, input: Scalar): Scalar | undefined {
  const conditional = source.match(/^(.+?)\s+if\s+value\s*==\s*(['"])(.*?)\2\s+else\s+(.+)$/s);
  if (conditional) {
    const whenTrue = conditional[1];
    const expected = conditional[3];
    const whenFalse = conditional[4];
    if (whenTrue === undefined || expected === undefined || whenFalse === undefined) {
      return undefined;
    }
    const branch = scalarText(input) === expected ? whenTrue.trim() : whenFalse.trim();
    if (branch === 'value') return input;
    const parsed = literal(branch);
    return parsed.matched ? parsed.value : undefined;
  }

  const [base, ...filters] = source.split('|').map((part) => part.trim());
  if (base !== 'value') return undefined;
  let value = input;

  for (const filter of filters) {
    if (filter === 'string') {
      value = scalarText(value);
      if (value === undefined) return undefined;
      continue;
    }
    if (filter === 'float' || filter === 'int') {
      if (typeof value === 'boolean' || value === null || value === undefined) return undefined;
      if (typeof value === 'string' && value.trim() === '') return undefined;
      const number = Number(value);
      if (!Number.isFinite(number)) return undefined;
      value = filter === 'int' ? Math.trunc(number) : number;
      continue;
    }
    const round = filter.match(/^round(?:\((\d+)\))?$/);
    if (round) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      const digits = Number(round[1] ?? '0');
      if (!Number.isInteger(digits) || digits < 0 || digits > 6) return undefined;
      value = rounded(value, digits);
      continue;
    }
    if (filter === 'lower' || filter === 'upper') {
      if (typeof value !== 'string') return undefined;
      value = filter === 'lower' ? value.toLowerCase() : value.toUpperCase();
      continue;
    }
    if (filter === 'tojson') {
      if (value === undefined || value === null) return undefined;
      const serialized = JSON.stringify(value);
      if (serialized === undefined) return undefined;
      value = serialized;
      continue;
    }
    const defaultFilter = filter.match(/^default\((.*)\)$/s);
    if (defaultFilter) {
      const fallbackSource = defaultFilter[1];
      if (fallbackSource === undefined) return undefined;
      const fallback = literal(fallbackSource);
      if (!fallback.matched) return undefined;
      if (value === undefined || value === null) value = fallback.value;
      continue;
    }
    return undefined;
  }

  return value;
}

function render(source: string, input: Scalar): string | undefined {
  const pattern = /\{\{\s*([^{}]*?)\s*\}\}/gs;
  let cursor = 0;
  let output = '';
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (
      source.slice(cursor, match.index).includes('{{') ||
      source.slice(cursor, match.index).includes('}}')
    ) {
      return undefined;
    }
    const templateExpression = match[1];
    if (templateExpression === undefined) return undefined;
    const result = expression(templateExpression.trim(), input);
    const text = scalarText(result);
    if (text === undefined) return undefined;
    output += source.slice(cursor, match.index) + text;
    cursor = pattern.lastIndex;
  }
  const tail = source.slice(cursor);
  if (
    tail.includes('{{') ||
    tail.includes('}}') ||
    source.includes('{%') ||
    source.includes('%}') ||
    source.includes('{#') ||
    source.includes('#}')
  ) {
    return undefined;
  }
  output += tail;
  return output.length <= maximumPayloadLength ? output : undefined;
}

/** Render the deliberately small HA `value` template subset without executing Jinja. */
export function renderCommandTemplate(template: string, value: unknown): CommandTemplateResult {
  if (template.length > maximumTemplateLength || (value !== null && typeof value === 'object')) {
    return { kind: 'unsupported' };
  }
  if (
    value !== null &&
    value !== undefined &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return { kind: 'unsupported' };
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return { kind: 'unsupported' };
  const payload = render(template, value);
  return payload === undefined ? { kind: 'unsupported' } : { kind: 'value', payload };
}
