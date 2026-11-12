/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { parseDevices } from '../types.js';
import { buildView } from '../entities.js';
import { translateService } from '../commands.js';

it('uses the explicit archive camera identity and each endpoint availability', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'native-camera',
        name: 'Outdoor',
        availability: 'online',
        connectivity: { protocol: 'local_ip' },
        category: 'cameras',
        endpoints: [
          {
            id: 'video',
            mediaId: 'camera.preserved_archive',
            availability: 'offline',
            capabilities: [{ id: 'video', kind: 'complex', operations: [] }],
          },
          {
            id: 'status',
            availability: 'online',
            capabilities: [{ id: 'on_off', kind: 'binary', operations: ['set'] }],
          },
        ],
      },
    ],
  });
  const view = buildView(devices, { status: { on_off: true } });
  expect(view.states.find((state) => state.entity_id === 'camera.preserved_archive')?.state).toBe(
    'unavailable',
  );
  expect(view.states.find((state) => state.entity_id.startsWith('switch.'))?.state).toBe('on');
  const malformed = parseDevices({
    devices: [{ id: 'x', endpoints: [{ id: 'y', mediaId: 'https://private/secret' }] }],
  });
  expect(malformed[0]?.endpoints[0]?.mediaId).toBeUndefined();
});

it('does not expose private transport sensor URLs to renderer state', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'camera',
        category: 'cameras',
        endpoints: [
          { id: 'stream', capabilities: [{ id: 'value', kind: 'string', operations: [] }] },
        ],
      },
    ],
  });
  const view = buildView(devices, { stream: { value: 'rtsp://user:secret@192.168.1.10/live' } });
  expect(view.states[0]?.state).toBe('unknown');
  expect(JSON.stringify(view.states)).not.toContain('secret');
});

it('projects media category devices to media_player and remote with TV attributes and commands', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'homebridge:appletv:02-af-ed-7a-cf-59',
        name: 'Bedroom Apple TV',
        category: 'media',
        availability: 'online',
        endpoints: [
          {
            id: 'television_0',
            capabilities: [
              { id: 'on_off', kind: 'binary', operations: ['turn_on', 'turn_off'] },
              { id: 'remote_key', kind: 'action', operations: ['send_command'] },
              { id: 'media_playback', kind: 'action', operations: ['play', 'pause', 'stop'] },
              { id: 'source', kind: 'enum', operations: ['select_source'] },
              { id: 'volume', kind: 'numeric', operations: ['set_volume'] },
              { id: 'mute', kind: 'binary', operations: ['mute'] },
            ],
          },
        ],
      },
    ],
  });

  const endpointState = {
    on_off: true,
    source_list: ['YouTube', 'Netflix', 'Prime Video'],
    source: 'YouTube',
    volume: 65,
    mute: false,
  };

  const view = buildView(devices, { television_0: endpointState });
  const mediaEntity = view.states.find((s) => s.entity_id.startsWith('media_player.'));
  const remoteEntity = view.states.find((s) => s.entity_id.startsWith('remote.'));

  expect(mediaEntity).toBeDefined();
  expect(mediaEntity?.state).toBe('idle');
  expect(mediaEntity?.attributes.device_class).toBe('tv');
  expect(mediaEntity?.attributes.source).toBe('YouTube');
  expect(mediaEntity?.attributes.source_list).toEqual(['YouTube', 'Netflix', 'Prime Video']);
  expect(mediaEntity?.attributes.volume_level).toBe(0.65);
  expect(mediaEntity?.attributes.is_volume_muted).toBe(false);

  expect(remoteEntity).toBeDefined();
  expect(remoteEntity?.state).toBe('on');

  // Verify command translations
  const offCmd = translateService(
    view.bindings,
    { service: 'turn_off', target: { entity_id: mediaEntity?.entity_id } },
    () => true,
  );
  expect(offCmd).toEqual([
    {
      deviceId: 'homebridge:appletv:02-af-ed-7a-cf-59',
      endpointId: 'television_0',
      capability: 'on_off',
      command: 'turn_off',
    },
  ]);

  const playPauseCmd = translateService(
    view.bindings,
    { service: 'media_play_pause', target: { entity_id: mediaEntity?.entity_id } },
    () => true,
  );
  expect(playPauseCmd).toEqual([
    {
      deviceId: 'homebridge:appletv:02-af-ed-7a-cf-59',
      endpointId: 'television_0',
      capability: 'media_playback',
      command: 'play_pause',
    },
  ]);

  const sourceCmd = translateService(
    view.bindings,
    {
      service: 'select_source',
      target: { entity_id: mediaEntity?.entity_id },
      service_data: { source: 'Netflix' },
    },
    () => true,
  );
  expect(sourceCmd).toEqual([
    {
      deviceId: 'homebridge:appletv:02-af-ed-7a-cf-59',
      endpointId: 'television_0',
      capability: 'source',
      command: 'set',
      parameters: { source: 'Netflix', option: 'Netflix' },
    },
  ]);

  const volumeCmd = translateService(
    view.bindings,
    {
      service: 'volume_set',
      target: { entity_id: mediaEntity?.entity_id },
      service_data: { volume_level: 0.8 },
    },
    () => true,
  );
  expect(volumeCmd).toEqual([
    {
      deviceId: 'homebridge:appletv:02-af-ed-7a-cf-59',
      endpointId: 'television_0',
      capability: 'volume',
      command: 'set',
      parameters: { value: 80, volume: 80 },
    },
  ]);

  const remoteCmd = translateService(
    view.bindings,
    {
      service: 'send_command',
      target: { entity_id: remoteEntity?.entity_id },
      service_data: { command: 'select' },
    },
    () => true,
  );
  expect(remoteCmd).toEqual([
    {
      deviceId: 'homebridge:appletv:02-af-ed-7a-cf-59',
      endpointId: 'television_0',
      capability: 'remote_key',
      command: 'send',
      parameters: { command: 'select', key: 'select' },
    },
  ]);
});
