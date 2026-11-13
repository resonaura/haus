/*
 * Haus — A thoughtful home
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
    cameraService.registerCamera({
      id: 'camera.front_door',
      name: 'Front Door',
      enabled: true,
      snapshotFetch: async () => Buffer.from('snapshot fixture'),
      operating: { indicator: true, nightVision: true },
      homekit: { paired: false, setupUri: 'X-HM://0023HAUSCAM1' },
    });
    cameraService.registerCamera({
      id: 'camera.backyard',
      name: 'Backyard',
      enabled: true,
      operating: { indicator: false, nightVision: true },
      homekit: { paired: true, setupUri: 'X-HM://0023HAUSCAM2' },
    });
    streamService = new DefaultStreamService();
    streamService.registerToken('cluster-token-123');
  });

  it('lists registered cameras and detectors with hardware metadata', async () => {
    const cameras = await cameraService.listCameras();
    expect(cameras.length).toBeGreaterThanOrEqual(2);
    expect(cameras.some((c) => c.id === 'camera.front_door')).toBe(true);

    const detectors = await cameraService.listDetectors();
    expect(detectors.length).toBeGreaterThanOrEqual(2);
    expect(detectors.some((d) => d.kind === 'tpu')).toBe(true);
  });

  it('bootstraps access tokens and returns the configured snapshot buffer', async () => {
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

    const answer = (await cameraService.viewerOffer('camera.front_door', 'user-1', 'view-100')) as {
      type: string;
      sdp: string;
    };
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
    const warmTouch = (await cameraService.touchWarm('camera.front_door', 'client-sub', true)) as {
      active: boolean;
    };
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
    expect(playlistResult.body as string).toContain(
      '/cluster/source/cluster-token-123/segment-10.ts',
    );

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

  it('returns 503 on live playlist and 404 on segment when RTSP source is unreachable', async () => {
    const svc = new DefaultCameraService();
    svc.registerCamera({
      id: 'camera.closed_rtsp',
      name: 'Closed RTSP',
      rtspUrl: 'rtsp://127.0.0.1:1/live',
    });
    const localStream = new DefaultStreamService(svc);

    const playlist = await localStream.getLivePlaylist('camera.closed_rtsp');
    expect(playlist.status).toBe(503);

    const segment = await localStream.getLiveSegment('camera.closed_rtsp', 'segment-0.ts');
    expect(segment.status).toBe(404);
  });

  it('delegates touchWarm to DefaultStreamService.warmLive when WarmStreams reports warm false', async () => {
    const mockWarm = {
      touch: async (_cam: unknown, owner: string, _active: boolean) => ({
        warm: false,
        owner,
        expiresAt: Date.now() + 60000,
      }),
    } as unknown as import('../../src/camera/control/warm.js').WarmStreams;

    const svc = new DefaultCameraService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockWarm,
    );
    svc.registerCamera({
      id: 'camera.hub_warm',
      name: 'Hub Warm',
      rtspUrl: 'rtsp://127.0.0.1:1/live',
    });
    const localStream = new DefaultStreamService(svc);

    const activated = (await svc.touchWarm('camera.hub_warm', 'desktop-1', true, false)) as {
      active: boolean;
      warm: boolean;
      source?: string;
      streamPath?: string;
    };
    expect(activated).toMatchObject({
      active: true,
      warm: true,
      source: 'hub',
      streamPath: '/api/cameras/camera.hub_warm/live/index.m3u8',
    });

    const deactivated = (await svc.touchWarm('camera.hub_warm', 'desktop-1', false, false)) as {
      active: boolean;
      warm: boolean;
      streamPath?: string;
    };
    expect(deactivated).toMatchObject({
      active: false,
      warm: false,
      streamPath: '/api/cameras/camera.hub_warm/live/index.m3u8',
    });

    const playlist = await localStream.getLivePlaylist('camera.hub_warm');
    expect(playlist.status).toBe(503);

    const missing = await localStream.getLivePlaylist('camera.unknown');
    expect(missing.status).toBe(404);

    svc.registerCamera({
      id: 'camera.no_rtsp',
      name: 'No RTSP',
    });
    const noRtsp = await localStream.getLivePlaylist('camera.no_rtsp');
    expect(noRtsp.status).toBe(404);
    await localStream.onModuleDestroy();
  });

  it('touchWarm reports stream_unavailable when hub stream warmer refuses to warm', async () => {
    const svc = new DefaultCameraService();
    svc.setStreamWarmer(() => false);
    svc.registerCamera({
      id: 'camera.unavailable_warm',
      name: 'Unavailable Warm',
    });
    const result = await svc.touchWarm('camera.unavailable_warm', 'desktop-1', true, false);
    expect(result).toEqual({
      active: false,
      warm: false,
      reason: 'stream_unavailable',
    });
  });
});
