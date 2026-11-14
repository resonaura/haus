/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it } from 'vitest';
import { attentionFlow, entryHasIssueOrAttention, entryNeedsAttention } from './integration-health';
import type { IntegrationEntry, FlowProgress } from '../../ha/management';
it('ties reauthentication to the exact regional account without mixing domains or disabled entries', () => {
  const entry = {
    entry_id: 'region-one',
    domain: 'xiaomi_home',
    title: 'Account EU',
    state: 'loaded',
    disabled_by: null,
  } as IntegrationEntry;
  const progress: FlowProgress[] = [
    {
      flow_id: 'reauth',
      handler: 'xiaomi_home',
      context: { source: 'reauth', entry_id: 'region-one' },
    },
  ];
  expect(entryNeedsAttention(entry, progress)).toBe(true);
  expect(attentionFlow(entry, progress)?.flow_id).toBe('reauth');
  expect(entryNeedsAttention({ ...entry, entry_id: 'region-two' }, progress)).toBe(false);
  expect(entryNeedsAttention({ ...entry, disabled_by: 'user' }, progress)).toBe(false);
  expect(attentionFlow({ ...entry, domain: 'different' }, progress)).toBeUndefined();
});
it('keeps setup failures visible even when HA has no reauthentication flow', () => {
  const entry = {
    entry_id: 'tv',
    domain: 'androidtv',
    title: 'TV',
    state: 'setup_retry',
    disabled_by: null,
  } as IntegrationEntry;
  expect(entryNeedsAttention(entry)).toBe(true);
  expect(entryNeedsAttention({ ...entry, state: 'loaded' })).toBe(false);
});
it('counts pending Tuya camera setup in attention status unless the entry is disabled', () => {
  const tuyaEntry = {
    entry_id: 'tuya-entry-1',
    domain: 'tuya',
    title: 'Tuya',
    state: 'loaded',
    disabled_by: null,
  } as IntegrationEntry;
  const pendingByEntry = new Map([['tuya-entry-1', [{ deviceId: 'tuya:cam_1' }]]]);

  expect(entryHasIssueOrAttention(tuyaEntry, [], [], pendingByEntry)).toBe(true);
  expect(
    entryHasIssueOrAttention({ ...tuyaEntry, disabled_by: 'user' }, [], [], pendingByEntry),
  ).toBe(false);
  expect(
    entryHasIssueOrAttention(
      { ...tuyaEntry, entry_id: 'other', domain: 'hue' },
      [],
      [{ domain: 'hue', ignored: false }],
      pendingByEntry,
    ),
  ).toBe(true);
  expect(
    entryHasIssueOrAttention(
      { ...tuyaEntry, entry_id: 'other', domain: 'hue' },
      [],
      [{ domain: 'hue', ignored: true }],
      pendingByEntry,
    ),
  ).toBe(false);
});
