/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { CameraSettings } from '../../ha/camera-settings';
import { activityPlacementNotice } from './activity-assist-status';

let mockedCamera: Partial<CameraSettings> | undefined;
vi.mock('../../hooks/useCameraSettings', () => ({
  useCameraSettings: () => mockedCamera as CameraSettings | undefined,
}));

const { MotionCaptureSettings } = await import('./MotionCaptureSettings');

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

it('selects Stream only by default when recording is false, omitted, or still loading, and switches to Stream & record when enabled', () => {
  mockedCamera = undefined;
  const loadingHtml = renderToStaticMarkup(
    createElement(MotionCaptureSettings, { cameraId: 'camera.guinea' }),
  );
  expect(loadingHtml).toMatch(/button--primary[^>]*aria-pressed="true"[^>]*>Stream only</);
  expect(loadingHtml).toMatch(
    /button--secondary[^>]*aria-pressed="false"[^>]*>Stream &amp; record</,
  );

  mockedCamera = { id: 'camera.guinea' };
  const omittedHtml = renderToStaticMarkup(
    createElement(MotionCaptureSettings, { cameraId: 'camera.guinea' }),
  );
  expect(omittedHtml).toMatch(/button--primary[^>]*aria-pressed="true"[^>]*>Stream only</);
  expect(omittedHtml).toMatch(
    /button--secondary[^>]*aria-pressed="false"[^>]*>Stream &amp; record</,
  );

  mockedCamera = { id: 'camera.guinea', enabled: false };
  const streamOnlyHtml = renderToStaticMarkup(
    createElement(MotionCaptureSettings, { cameraId: 'camera.guinea' }),
  );
  expect(streamOnlyHtml).toMatch(/button--primary[^>]*aria-pressed="true"[^>]*>Stream only</);
  expect(streamOnlyHtml).toMatch(
    /button--secondary[^>]*aria-pressed="false"[^>]*>Stream &amp; record</,
  );

  mockedCamera = { id: 'camera.guinea', enabled: true };
  const recordHtml = renderToStaticMarkup(
    createElement(MotionCaptureSettings, { cameraId: 'camera.guinea' }),
  );
  expect(recordHtml).toMatch(/button--secondary[^>]*aria-pressed="false"[^>]*>Stream only</);
  expect(recordHtml).toMatch(/button--primary[^>]*aria-pressed="true"[^>]*>Stream &amp; record</);
});
