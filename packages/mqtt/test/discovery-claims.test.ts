/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { discoveryClaims, parseDiscoveryClaims } from '../src/discovery/claims.js';
import { DiscoveryTopics } from '../src/discovery/topics.js';

const topics = new DiscoveryTopics(['homeassistant']);

it('tracks only the identities in the latest retained projection', () => {
  const topic = topics.parse('homeassistant/switch/panel/config');
  if (!topic) throw Error('fixture_topic_invalid');
  expect(
    discoveryClaims(topic, JSON.stringify({ unique_id: 'first', device: { ids: ['panel'] } })),
  ).toEqual([
    { kind: 'device', device: 'panel' },
    { kind: 'endpoint', device: 'panel', component: 'switch', uniqueId: 'first' },
  ]);
  expect(
    discoveryClaims(
      topic,
      JSON.stringify({ unique_id: 'replacement', device: { ids: ['panel'] } }),
    ),
  ).toEqual([
    { kind: 'device', device: 'panel' },
    { kind: 'endpoint', device: 'panel', component: 'switch', uniqueId: 'replacement' },
  ]);
  expect(discoveryClaims(topic, '')).toEqual([]);
});

it('ignores explicit removed bundle components and keeps active siblings', () => {
  const topic = topics.parse('homeassistant/device/panel/config');
  if (!topic) throw Error('fixture_topic_invalid');
  expect(
    discoveryClaims(
      topic,
      JSON.stringify({
        dev: { ids: ['panel'] },
        cmps: {
          relay: { p: 'switch', unique_id: 'relay' },
          removed: { p: 'sensor' },
        },
      }),
    ),
  ).toEqual([
    { kind: 'device', device: 'panel' },
    { kind: 'endpoint', device: 'panel', component: 'switch', uniqueId: 'relay' },
  ]);
});

it('rejects malformed, duplicated, oversized, and extra-field stored claims', () => {
  const claim = { kind: 'endpoint', device: 'panel', component: 'switch', uniqueId: 'relay' };
  expect(parseDiscoveryClaims(JSON.stringify([claim]))).toEqual([claim]);
  for (const malformed of [
    JSON.stringify([claim, claim]),
    JSON.stringify([{ ...claim, extra: true }]),
    '{',
    ' '.repeat(1_000_001),
  ])
    expect(() => parseDiscoveryClaims(malformed)).toThrow('mqtt_retained_claims_invalid');
});
