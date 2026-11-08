/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { isHausActivity } from '@haus/ha/node/activity';
import {
  CameraActivity,
  activityKey,
  type CameraActivityItem,
  type CameraActivitySensor,
} from '../../src/camera/index.js';

function fixture() {
  let now = 100000;
  let healthy = true;
  const captures: [string, string, string, number][] = [];
  const activity = new CameraActivity({
    now: () => now,
    recorder: {
      trigger: async (...args) => {
        captures.push(args);
      },
    },
    motion: {
      status: () => ({
        state: healthy ? 'running' : 'waiting',
        fresh: healthy,
      }),
    },
  });
  const sensors: CameraActivitySensor[] = [
    {
      id: 'binary_sensor.front_motion',
      source: 'device',
      kind: 'motion',
      active: true,
      available: true,
    },
  ];
  const camera: CameraActivityItem & { sensors: CameraActivitySensor[] } = {
    id: 'camera.front',
    available: true,
    motionDetection: { enabled: true },
    sensors,
  };
  activity.sync([camera]);
  return {
    activity,
    camera,
    captures,
    advance: (ms: number) => {
      now += ms;
    },
    unhealthy: () => {
      healthy = false;
    },
  };
}

describe('CameraActivity', () => {
  it('Assist validates native generic movement rather than recording leaves first', () => {
    const { activity, captures, camera } = fixture();
    activity.native(camera.id, 'motion', camera.sensors[0].id);
    assert.equal(captures.length, 0);
    assert.equal(activity.status(camera.id).active, false);
    assert.deepEqual(activity.activeSensors(camera), []);
    activity.software(camera.id, { kind: 'person', at: 98000 });
    assert.equal(captures.length, 1);
    assert.equal(captures[0][3], 98000);
    assert.equal(activity.activeSensors(camera).length, 1);
  });

  it('native semantic and software detections coalesce without changing raw entities', () => {
    const { activity, captures, camera } = fixture();
    activity.native(camera.id, 'person', 'binary_sensor.front_person');
    activity.software(camera.id, { kind: 'person', at: 100000 });
    assert.equal(captures.length, 1);
    assert.equal(camera.sensors[0].active, true);
  });

  it('independent PIR sensors stay useful while camera-native pixel motion is filtered', () => {
    const { activity, captures, camera } = fixture();
    camera.sensors.push({
      id: 'binary_sensor.hue_pir',
      kind: 'motion',
      source: 'name',
      independent: true,
      available: true,
      active: true,
    });
    activity.native(camera.id, 'motion', 'binary_sensor.hue_pir');
    assert.equal(captures.length, 1);
    assert.equal(activity.status(camera.id).active, true);
    assert.deepEqual(activity.status(camera.id).replaces, ['binary_sensor.front_motion']);
  });

  it('a name-linked HA group without physical identity cannot bypass Assist validation', () => {
    const { activity, captures, camera } = fixture();
    camera.sensors[0] = {
      id: 'binary_sensor.front_group',
      source: 'name',
      kind: 'motion',
      available: true,
      active: true,
    };
    activity.native(camera.id, 'motion', camera.sensors[0].id);
    activity.tick();
    assert.equal(activity.status(camera.id).active, false);
    assert.equal(captures.length, 0);
  });

  it('unavailable analysis falls back explicitly to native motion, never a false clear', () => {
    const { activity, captures, camera, unhealthy, advance } = fixture();
    unhealthy();
    activity.native(camera.id, 'motion', camera.sensors[0].id);
    assert.equal(captures.length, 0);
    assert.equal(activity.status(camera.id).source, 'analysis_unavailable');
    advance(30001);
    activity.native(camera.id, 'motion', camera.sensors[0].id);
    assert.equal(captures.length, 1);
    assert.equal(activity.status(camera.id).source, 'native_fallback');
    camera.sensors = [];
    assert.equal(activity.status(camera.id).available, false);
  });

  it('software-only sensors expire; stream-only state works; old events cannot wake them', () => {
    const { activity, captures, camera, advance } = fixture();
    camera.sensors = [];
    activity.software(camera.id, { kind: 'motion', at: 100000 });
    assert.equal(activity.status(camera.id).active, true);
    advance(10001);
    assert.equal(activity.status(camera.id).active, false);
    activity.software(camera.id, { kind: 'motion', at: 1 });
    assert.equal(captures.length, 1);
    camera.available = false;
    assert.equal(activity.status(camera.id).available, false);
    assert.equal(activityKey(camera.id), activityKey(camera.id));
    assert.ok(
      isHausActivity(
        {
          attributes: { haus_activity_version: 1, haus_camera: camera.id },
        },
        undefined,
      ),
    );
  });

  it('managed software and native semantic detections update canonical state without a second controller recording', () => {
    const { activity, captures, camera } = fixture();
    let native = 0;
    activity.captureNative = (id, kind) => {
      assert.equal(id, camera.id);
      assert.equal(kind, 'person');
      native++;
      return true;
    };
    activity.software(camera.id, {
      kind: 'pet',
      at: 100000,
      recordingManaged: true,
    });
    assert.equal(activity.status(camera.id).active, true);
    assert.equal(captures.length, 0);
    activity.native(camera.id, 'person', 'native-person', 100000);
    assert.equal(native, 1);
    assert.equal(captures.length, 0);
  });
});
