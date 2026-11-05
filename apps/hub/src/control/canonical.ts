/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Json } from '@haus/core/types';

export function canonical(value: Json, ancestors = new Set<object>(), depth = 0): string {
  if (depth > 64) throw Error('invalid_command_value');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || ancestors.has(value))
    throw Error('invalid_command_value');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw Error('invalid_command_value');
  ancestors.add(value);
  try {
    const result = Array.isArray(value)
      ? '[' + Array.from(value, (item) => canonical(item, ancestors, depth + 1)).join(',') + ']'
      : '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + canonical(value[key], ancestors, depth + 1))
          .join(',') +
        '}';
    if (result.length > 65536) throw Error('invalid_command_value');
    return result;
  } finally {
    ancestors.delete(value);
  }
}
