import { expect, it } from 'vitest';
import { activityPlacementNotice } from './activity-assist-status';

it('explains NVR selection without a Home Assistant load warning', () => {
  const notice = activityPlacementNotice({
    state: 'off',
    placement: 'nvr',
    processor: 'Media server',
  });
  expect(notice?.warning).toBe(false);
  expect(notice?.title).toBe('Media server');
  expect(notice?.description).toContain('least-loaded');
});
it('shows the host-load warning even before Activity assist is enabled', () => {
  const notice = activityPlacementNotice({
    state: 'off',
    placement: 'home',
    processor: 'Home Assistant',
    fallbackReason: 'no_nodes',
  });
  expect(notice?.warning).toBe(true);
  expect(notice?.description).toContain('No NVR nodes');
  expect(notice?.description).toContain('significant load');
  expect(notice?.title).toContain('Home Assistant');
});
it('distinguishes node outages, capacity waiting and an unsupported host', () => {
  expect(
    activityPlacementNotice({
      state: 'waiting',
      placement: 'home',
      fallbackReason: 'nodes_unavailable',
      blocked: 'capacity',
    })?.description,
  ).toContain('waits');
  expect(
    activityPlacementNotice({ state: 'waiting', placement: 'home', fallbackReason: 'nodes_busy' })
      ?.description,
  ).toContain('busy or recovering');
  expect(
    activityPlacementNotice({ state: 'off', placement: 'home', blocked: 'unsupported' })
      ?.description,
  ).toContain('cannot run local analysis');
  expect(activityPlacementNotice({ state: 'off' })).toBeUndefined();
});
