import { describe, expect, it } from 'vitest';
import type { HassEntity } from '../../model';
import { cameraPtzButtons } from './ptz-controls';

const button = (entity_id: string, friendly_name: string): HassEntity => ({
  entity_id,
  state: 'unknown',
  attributes: { friendly_name },
  last_changed: '',
});

describe('camera PTZ button discovery', () => {
  it('maps only associated button entities to directional and lens controls', () => {
    const mapped = cameraPtzButtons([
      button('button.camera_pan_left', 'Pan Left'),
      button('button.camera_pan_right', 'Pan Right'),
      button('button.camera_tilt_up', 'Tilt Up'),
      button('button.camera_tilt_down', 'Tilt Down'),
      button('button.camera_zoom_in', 'Zoom In'),
      button('button.camera_zoom_out', 'Zoom Out'),
      button('button.camera_stop', 'Stop PTZ'),
      button('button.camera_recall_home', 'Return to Home Position'),
      button('switch.camera_privacy', 'Privacy mode'),
    ]);

    expect(mapped).toMatchObject({
      left: { entity_id: 'button.camera_pan_left' },
      right: { entity_id: 'button.camera_pan_right' },
      up: { entity_id: 'button.camera_tilt_up' },
      down: { entity_id: 'button.camera_tilt_down' },
      zoomIn: { entity_id: 'button.camera_zoom_in' },
      zoomOut: { entity_id: 'button.camera_zoom_out' },
      stop: { entity_id: 'button.camera_stop' },
      home: { entity_id: 'button.camera_recall_home' },
    });
  });

  it('requires a real movement pair and ignores unrelated switches', () => {
    expect(
      cameraPtzButtons([
        button('button.camera_reboot', 'Reboot Camera'),
        button('button.camera_stop', 'Stop'),
      ]),
    ).toBeUndefined();
    expect(
      cameraPtzButtons([
        { ...button('button.camera_left', 'Pan Left'), state: 'unavailable' },
        button('button.camera_down', 'Tilt Down'),
        button('switch.camera_right', 'Pan Right'),
      ]),
    ).toMatchObject({ left: { state: 'unavailable' } });
  });

  it('never treats stopping a stream or compass words in device names as motor controls', () => {
    const mapped = cameraPtzButtons([
      button('button.north_camera_stop_p2p_stream', 'North Camera Stop P2P stream'),
      button('button.north_camera_reboot', 'North Camera Reboot'),
      button('button.north_camera_ptz_left', 'North Camera PTZ Left'),
      button('button.north_camera_ptz_right', 'North Camera PTZ Right'),
    ]);
    expect(mapped?.left?.entity_id).toBe('button.north_camera_ptz_left');
    expect(mapped?.right?.entity_id).toBe('button.north_camera_ptz_right');
    expect(mapped?.stop).toBeUndefined();
    expect(mapped?.up).toBeUndefined();
    expect(mapped?.zoomOut).toBeUndefined();
  });
});
