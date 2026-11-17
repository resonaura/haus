/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it } from 'vitest';
import { parseHaEntryImport } from '../../src/commissioning/ha-flow/import.js';

const disabledByValues = ['config_entry', 'device', 'hass', 'integration', 'user'] as const;

function payload(disabledBy: unknown, entityCategory?: unknown) {
  return {
    entry: {
      entryId: 'fixture-hue-entry',
      domain: 'hue',
      title: 'Fixture Hue bridge',
      data: {},
      disabledBy: 'user',
    },
    entities: [
      {
        entity_id: 'light.fixture',
        platform: 'hue',
        unique_id: 'fixture-light',
        disabled_by: disabledBy,
        ...(entityCategory !== undefined ? { entity_category: entityCategory } : {}),
      },
    ],
    devices: [],
    areas: [],
  };
}

it.each(disabledByValues)('accepts HA entity disabled_by=%s', (disabledBy) => {
  const imported = parseHaEntryImport(payload(disabledBy));
  expect(imported.entities?.[0]?.disabled_by).toBe(disabledBy);
});

it('rejects unknown HA entity disable reasons', () => {
  expect(() => parseHaEntryImport(payload('unknown'))).toThrow();
});

it.each(['config', 'diagnostic'])('accepts HA entity_category=%s', (entityCategory) => {
  const imported = parseHaEntryImport(payload('user', entityCategory));
  expect(imported.entities?.[0]?.entity_category).toBe(entityCategory);
});

it('rejects unknown HA entity categories', () => {
  expect(() => parseHaEntryImport(payload('user', 'unknown'))).toThrow();
});

it('retains a custom integration minor version of zero', () => {
  const input = payload('user');
  const imported = parseHaEntryImport({
    ...input,
    entry: { ...input.entry, version: 3, minorVersion: 0 },
  });
  expect(imported.entry.version).toBe(3);
  expect(imported.entry.minorVersion).toBe(0);
  expect(imported.entry.disabledBy).toBe('user');
});

it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid minor version %s', (minorVersion) => {
  const input = payload('user');
  expect(() =>
    parseHaEntryImport({ ...input, entry: { ...input.entry, minorVersion } }),
  ).toThrow();
});
