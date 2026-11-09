/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  buildAvailabilityRule,
  combineAvailability,
  inheritAvailability,
  readAvailability,
  expandHaDiscoveryPayload,
} from '../src/index.js';

describe('MQTT availability', () => {
  it('uses configured payloads and extracts availability through a supported template', () => {
    const rule = buildAvailabilityRule({
      availability_topic: 'bridge/status',
      availability_template: '{{ value_json.state }}',
      payload_available: 'ready',
      payload_not_available: 'lost',
    });

    expect(rule).toEqual({
      mode: 'latest',
      topics: [
        {
          topic: 'bridge/status',
          payload_available: 'ready',
          payload_not_available: 'lost',
          value_template: '{{ value_json.state }}',
        },
      ],
    });
    expect(readAvailability(rule!, 'bridge/status', '{"state":"ready"}')).toEqual({
      availability: 'online',
      templateResultAvailable: true,
    });
    expect(readAvailability(rule!, 'bridge/status', '{"state":"lost"}').availability).toBe(
      'offline',
    );
    expect(readAvailability(rule!, 'bridge/status', '{"state":"starting"}').availability).toBe(
      'unknown',
    );
    expect(readAvailability(rule!, 'bridge/status', 'malformed').templateResultAvailable).toBe(
      false,
    );
  });

  it('inherits bundle availability while allowing a component to override it', () => {
    const inherited = inheritAvailability(
      {
        availability: [{ topic: 'bridge/online' }, { topic: 'device/online' }],
        availability_mode: 'all',
        payload_available: 'yes',
      },
      { platform: 'sensor' },
    );
    expect(buildAvailabilityRule(inherited)?.mode).toBe('all');
    expect(
      buildAvailabilityRule(inherited)?.topics.map((entry) => entry.payload_available),
    ).toEqual(['yes', 'yes']);

    const overridden = inheritAvailability(
      { availability_topic: 'bridge/online' },
      { platform: 'sensor', availability_topic: 'device/online' },
    );
    expect(buildAvailabilityRule(overridden)?.topics.map((entry) => entry.topic)).toEqual([
      'device/online',
    ]);
  });

  it('expands abbreviated availability and resolves its base topic', () => {
    const expanded = expandHaDiscoveryPayload({
      '~': 'bridge/device',
      avty_mode: 'all',
      avty: [{ t: '~/status', pl_avail: 'up', val_tpl: '{{ value_json.state }}' }],
    });
    expect(expanded.availability_mode).toBe('all');
    expect(expanded.availability).toEqual([
      {
        topic: 'bridge/device/status',
        payload_available: 'up',
        value_template: '{{ value_json.state }}',
      },
    ]);
  });

  it('combines multi-topic availability with all, any and latest rules', () => {
    const topics = [{ topic: 'a' }, { topic: 'b' }];
    const states = new Map<string, 'online' | 'offline' | 'unknown'>([
      ['a', 'online'],
      ['b', 'unknown'],
    ]);
    expect(combineAvailability({ mode: 'all', topics }, states)).toBe('unknown');
    expect(combineAvailability({ mode: 'any', topics }, states)).toBe('online');
    expect(combineAvailability({ mode: 'latest', topics }, states, 'b')).toBe('unknown');
    states.set('b', 'offline');
    expect(combineAvailability({ mode: 'all', topics }, states)).toBe('offline');
    expect(combineAvailability({ mode: 'any', topics }, states)).toBe('online');
    expect(combineAvailability({ mode: 'latest', topics }, states, 'b')).toBe('offline');
  });
});
