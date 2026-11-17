/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it } from 'vitest';
import { validateRequest } from '../../src/native/validation.js';

const disabledByValues = ['config_entry', 'device', 'hass', 'integration', 'user'] as const;

function request(disabledBy: unknown, entityCategory?: unknown) {
  return {
    type: 'ha/config_entries/import',
    entry: {
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
    },
  };
}

it.each(disabledByValues)('accepts HA registry disabled_by=%s', (disabledBy) => {
  expect(validateRequest(request(disabledBy)).type).toBe('ha/config_entries/import');
});

it('rejects unknown HA registry disable reasons', () => {
  expect(() => validateRequest(request('unknown'))).toThrow();
});

it.each(['config', 'diagnostic'])('accepts HA entity category=%s', (entityCategory) => {
  expect(validateRequest(request('user', entityCategory)).type).toBe('ha/config_entries/import');
});

it('rejects unknown HA entity categories', () => {
  expect(() => validateRequest(request('user', 'unknown'))).toThrow();
});

it('preserves an imported integration with minor version zero', () => {
  const input = request('user');
  const entry = { ...input.entry.entry, version: 3, minorVersion: 0 };
  expect(validateRequest({ ...input, entry: { ...input.entry, entry } })).toEqual({
    ...input,
    entry: { ...input.entry, entry },
  });
});

it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid minor version %s',
  (minorVersion) => {
    const input = request('user');
    expect(() =>
      validateRequest({
        ...input,
        entry: { ...input.entry, entry: { ...input.entry.entry, minorVersion } },
      }),
    ).toThrow();
  },
);
