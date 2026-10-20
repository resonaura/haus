import { expect, it } from 'vitest';
import { attentionFlow, entryNeedsAttention } from './integration-health';
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
