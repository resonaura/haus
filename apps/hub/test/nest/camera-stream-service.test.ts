/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultCameraService } from '../../src/camera/camera.service.js';
import { DefaultStreamService } from '../../src/stream/stream.service.js';

describe('Camera & Stream Production Services Suite', () => {
  let cameraService: DefaultCameraService;
  let streamService: DefaultStreamService;

  beforeEach(() => {
    cameraService = new DefaultCameraService();
    streamService = new DefaultStreamService();
  });

  it('lists registered cameras and detectors with hardware metadata', async () => {
    const cameras = await cameraService.listCameras();
    expect(cameras.length).toBeGreaterThanOrEqual(2);
    expect(cameras.some((c) => c.id === 'camera.front_door')).toBe(true);

    const detectors = await cameraService.listDetectors();
    expect(detectors.length).toBeGreaterThanOrEqual(2);
    expect(detectors.some((d) => d.kind === 'tpu')).toBe(true);
  });

  it('bootstraps access tokens and delivers valid JPEG snapshot buffers', async () => {
    const access = await cameraService.bootstrapAccess('camera.front_door', 'client-xyz');
    expect(access.token).toBeDefined();
    expect(access.expiresAt).toBeGreaterThan(Date.now());

    const snapshot = await cameraService.getSnapshot('camera.front_door');
    expect(snapshot.mime).toBe('image/jpeg');
    expect(Buffer.isBuffer(snapshot.buffer)).toBe(true);
    expect(snapshot.buffer.length).toBeGreaterThan(0);
  });

  it('controls hardware operating indicators and manages WebRTC viewer sessions', async () => {
    const indicatorResult = await cameraService.setOperating(
      'camera.front_door',
      'indicator',
      'switch.front_door_indicator',
      false,
    );
    expect(indicatorResult.accepted).toBe(true);

    const answer = (await cameraService.viewerOffer(
      'camera.front_door',
      'user-1',
      'view-100',
    )) as { type: string; sdp: string };
    expect(answer.type).toBe('answer');
    expect(answer.sdp).toContain('HausViewer');

    const closeResult = (await cameraService.closeViewer(
      'camera.front_door',
      'user-1',
      'view-100',
    )) as { closed: boolean };
    expect(closeResult.closed).toBe(true);
  });

  it('tracks warm stream subscribers and coordinates HomeKit pairing', async () => {
    const warmTouch = (await cameraService.touchWarm(
      'camera.front_door',
      'client-sub',
      true,
    )) as { active: boolean };
    expect(warmTouch.active).toBe(true);

    const pairing = (await cameraService.getHomeKitPairing('camera.front_door')) as {
      paired: boolean;
      uri: string;
    };
    expect(pairing.uri).toContain('X-HM://');

    const reset = (await cameraService.manageHomeKitPairing('camera.front_door', 'reset')) as {
      paired: boolean;
    };
    expect(reset.paired).toBe(false);
  });

  it('rewrites HLS stream playlists with cluster proxy prefix', async () => {
    const playlistResult = await streamService.getSource('cluster-token-123', 'index.m3u8');
    expect(playlistResult.status).toBe(200);
    expect(playlistResult.mime).toBe('application/vnd.apple.mpegurl');
    expect(typeof playlistResult.body).toBe('string');
    expect(playlistResult.body as string).toContain('/cluster/source/cluster-token-123/segment-10.ts');

    const segmentResult = await streamService.getSource('cluster-token-123', 'segment-10.ts');
    expect(segmentResult.status).toBe(200);
    expect(segmentResult.mime).toBe('video/MP2T');
    expect(Buffer.isBuffer(segmentResult.body)).toBe(true);
  });

  it('serves live camera HLS playlist and video segments', async () => {
    const live = await streamService.getLivePlaylist('camera.front_door');
    expect(live.status).toBe(200);
    expect(typeof live.body).toBe('string');
    expect(live.body as string).toContain('#EXTM3U');

    const segment = await streamService.getLiveSegment('camera.front_door', 'segment-0.ts');
    expect(segment.status).toBe(200);
    expect(segment.mime).toBe('video/MP2T');
  });
});
