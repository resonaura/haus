/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { bundleDiscovery, componentDiscovery, expandHaDiscoveryPayload } from '../src/index.js';

it('validates JSON attribute topics and templates as discovery strings', () => {
  expect(
    componentDiscovery({
      json_attributes_topic: 'sensor/attributes',
      json_attributes_template: '{{ value_json }}',
    }),
  ).toBe(true);
  expect(
    componentDiscovery({
      json_attributes_topic: 'sensor/attributes',
      json_attributes_template: 7,
    }),
  ).toBe(false);
  expect(componentDiscovery({ json_attributes_topic: '  ' })).toBe(false);
});

it('rejects an entire bundle with malformed components instead of silently dropping them', () => {
  for (const invalid of [null, 12, 'sensor', [], { state_topic: 4 }]) {
    const expanded = expandHaDiscoveryPayload({
      dev: { ids: ['fixture'] },
      cmps: { good: { p: 'sensor', stat_t: 'fixture/state' }, bad: invalid },
    });
    expect(bundleDiscovery(expanded)).toBe(false);
  }
});

it('treats prototype-looking provider keys as data without changing object prototypes', () => {
  const raw: unknown = JSON.parse(
    '{"__proto__":{"state_topic":12},"toString":"provider","dev":{"__proto__":{"name":"wrong"},"ids":["fixture"]},"cmps":{"__proto__":{"p":"sensor","stat_t":"fixture/state"}}}',
  );
  if (!componentDiscovery(raw)) throw Error('invalid_fixture');
  const expanded = expandHaDiscoveryPayload(raw);
  expect(Object.getPrototypeOf(expanded)).toBe(Object.prototype);
  expect(Object.hasOwn(expanded, '__proto__')).toBe(true);
  expect(expanded.toString).toBe('provider');
  expect(bundleDiscovery(expanded)).toBe(true);
  expect(expanded.components).toEqual({
    ['__proto__']: { platform: 'sensor', state_topic: 'fixture/state' },
  });
});
