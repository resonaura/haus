/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  ORIGINAL_PLAYBACK_POLICY_VERSION,
  cameraPtzButtonIds,
  cameraPtzButtons,
  canPlayOriginalImmediately,
  chronologicalRecordings,
  demoCameraEvents,
  filterCameraRelatedControls,
  formatEventKindLabel,
  isHiddenCameraControl,
  nextRecording,
  recordingDay,
  recordingDayRange,
  recordingMonthBoundaries,
  recordingSeek,
  recordingStart,
  type CameraEvent,
  type TransportEntityState,
} from '../../src/transport/index.js';

const entity = (
  entity_id: string,
  state = 'unknown',
  attributes: Record<string, unknown> = {},
): TransportEntityState => ({
  entity_id,
  state,
  attributes,
});

describe('camera-ptz core helpers', () => {
  it('detects PTZ buttons and filters non-PTZ related controls without duplication', () => {
    const entities: TransportEntityState[] = [
      entity('camera.front', 'idle'),
      entity('button.front_ptz_up', 'unknown', { friendly_name: 'Front PTZ Up' }),
      entity('button.front_ptz_down', 'unknown', { friendly_name: 'Front PTZ Down' }),
      entity('button.front_zoom_in', 'unknown', { friendly_name: 'Front Zoom In' }),
      entity('button.front_stop_ptz', 'unknown', { friendly_name: 'Front Stop PTZ' }),
      entity('switch.front_indicator', 'on', { friendly_name: 'Status Light' }),
      entity('switch.front_siren', 'off', { friendly_name: 'Siren' }),
      entity('switch.front_p2p_stream', 'on', { friendly_name: 'P2P Stream' }),
      entity('switch.front_ptz_cruise', 'off', { friendly_name: 'PTZ Cruise' }),
      entity('switch.front_human_tracking', 'unavailable', { friendly_name: 'Human Tracking' }),
      entity('sensor.front_fps', '15'),
      entity('number.front_segment', '1', { haus_segment_role: 'duration' }),
    ];

    const ptz = cameraPtzButtons(entities);
    expect(ptz?.up?.entity_id).toBe('button.front_ptz_up');
    expect(ptz?.down?.entity_id).toBe('button.front_ptz_down');
    expect(ptz?.zoomIn?.entity_id).toBe('button.front_zoom_in');
    expect(ptz?.stop?.entity_id).toBe('button.front_stop_ptz');

    const ids = cameraPtzButtonIds(entities);
    expect([...ids]).toEqual(
      expect.arrayContaining([
        'button.front_ptz_up',
        'button.front_ptz_down',
        'button.front_zoom_in',
        'button.front_stop_ptz',
      ]),
    );
    expect(isHiddenCameraControl(entities[7])).toBe(true);
    expect(isHiddenCameraControl(entities[8])).toBe(true);
    expect(isHiddenCameraControl(entities[9])).toBe(true);
    expect(isHiddenCameraControl(entities[6])).toBe(false);

    const related = filterCameraRelatedControls(
      'camera.front',
      entities,
      new Set(['switch.front_indicator']),
    );
    expect(related.map((item) => item.entity_id)).toEqual(['switch.front_siren']);
  });
});

describe('camera-history core helpers', () => {
  it('handles original playback policy, seeking, chronological ordering, and next recording', () => {
    const eventA: CameraEvent = {
      id: 'b-event',
      cameraId: 'camera.porch',
      startAt: 2000,
      mediaStartAt: 1500,
      endAt: 5000,
      status: 'ready',
      kinds: ['motion'],
      duration: 3,
      playbackInfo: {
        originalCompatible: true,
        originalPolicyVersion: ORIGINAL_PLAYBACK_POLICY_VERSION,
      },
      bytes: 1000,
    };
    const eventFailed: CameraEvent = {
      id: 'c-event',
      cameraId: 'camera.porch',
      startAt: 6000,
      endAt: 7000,
      status: 'failed',
      kinds: ['motion'],
      duration: 1,
      bytes: 0,
    };
    const eventC: CameraEvent = {
      id: 'a-event',
      cameraId: 'camera.porch',
      startAt: 8000,
      endAt: 12000,
      status: 'ready',
      kinds: ['person'],
      duration: 4,
      bytes: 2000,
    };

    expect(canPlayOriginalImmediately(eventA)).toBe(true);
    expect(canPlayOriginalImmediately(eventC)).toBe(false);
    expect(recordingStart(eventA)).toBe(1500);
    expect(recordingSeek(5, 3)).toBeCloseTo(2.95);
    expect(recordingSeek(-1, 3)).toBe(0);

    const ordered = chronologicalRecordings([eventC, eventFailed, eventA]);
    expect(ordered.map((e) => e.id)).toEqual(['b-event', 'c-event', 'a-event']);
    expect(nextRecording(ordered, 'b-event')?.id).toBe('a-event');
    expect(nextRecording(ordered, 'a-event')).toBeUndefined();
  });

  it('computes recording days, ranges, month boundaries, labels, and demo events', () => {
    const sample = new Date('2026-06-15T00:05:00').getTime();
    const day = recordingDay(sample);
    expect(day).toBe('2026-06-15');
    const range = recordingDayRange(day);
    expect(range.to).toBeGreaterThan(range.from);
    expect(recordingMonthBoundaries('2026-06')).toHaveLength(31);
    expect(formatEventKindLabel('manual')).toBe('Manual recording');
    expect(formatEventKindLabel('person')).toBe('Person');

    const demo = demoCameraEvents('camera.living_room', sample);
    expect(demo).toHaveLength(4);
    expect(demo[0].id).toBe('demo-camera.living_room-0');
    expect(demo.every((e) => e.status === 'ready' && e.startAt >= range.from && e.startAt < range.to)).toBe(
      true,
    );
  });
});
