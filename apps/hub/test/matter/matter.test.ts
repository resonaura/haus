/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { MatterService } from '../../src/matter/service.js';

beforeEach(() => {
  vi.stubEnv('HAUS_MATTER_URL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Haus Native Matter Integration Service', () => {
  it('does not connect or discover Matter nodes without an explicit server endpoint', async () => {
    const homeService = new StandaloneHomeService();
    const matterService = new MatterService(homeService);

    expect(matterService.isConfigured).toBe(false);
    expect(matterService.transport).toBeUndefined();
    await matterService.onApplicationBootstrap();
    expect(homeService.listDevices()).toEqual([]);
    await expect(matterService.refreshNodes()).rejects.toThrow('matter_server_not_configured');
    await matterService.onApplicationShutdown();
  });

  it('discovers Matter bridge and child devices, syncs attribute changes, and routes commands', async () => {
    const receivedCommands: Array<Record<string, unknown>> = [];

    // 1. Create mock Matter Server
    const server = createServer();
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      // Initial server info handshake
      ws.send(JSON.stringify({ sdk_version: 'matter.js/0.18.0' }));

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.command === 'get_nodes') {
          ws.send(
            JSON.stringify({
              message_id: msg.message_id,
              result: [
                {
                  node_id: 1,
                  available: true,
                  attributes: {
                    '0/40/3': 'Aqara Hub M2',
                    '0/40/5': 'Aqara Hub M2',
                    // Ep 7: Switch (Toggle Stereo Power)
                    '7/57/1': 'Aqara',
                    '7/57/3': 'Toggle Stereo Power',
                    '7/57/5': 'Toggle Stereo Power',
                    '7/57/15': 'serial_stereo_power',
                    '7/6/0': false,
                    // Ep 4: Door/Window sensor
                    '4/57/1': 'Aqara',
                    '4/57/3': 'Aqara Door and Window Sensor',
                    '4/57/5': 'Aqara Door and Window Sensor',
                    '4/57/15': 'serial_door_sensor',
                    '4/69/0': true, // true = closed
                    // Ep 2: Water leak sensor
                    '2/57/1': 'Aqara',
                    '2/57/3': 'Aqara Water Leak Sensor',
                    '2/57/5': 'Aqara Water Leak Sensor',
                    '2/57/15': 'serial_water_leak',
                    '2/69/0': false, // false = dry
                  },
                },
              ],
            }),
          );
        } else if (msg.command === 'device_command') {
          receivedCommands.push(msg.args as Record<string, unknown>);
          ws.send(JSON.stringify({ message_id: msg.message_id, result: null }));
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}/ws`;
    vi.stubEnv('HAUS_MATTER_URL', url);

    const homeService = new StandaloneHomeService();
    const matterService = new MatterService(homeService);

    await matterService.onApplicationBootstrap();

    // 2. Verify devices were discovered and registered
    const bridge = homeService.getDevice('matter_node_1_bridge');
    expect(bridge).toBeDefined();
    expect(bridge?.name).toBe('Aqara Hub M2');
    expect(bridge?.category).toBe('network');

    const stereo = homeService.getDevice('matter_node_1_ep_7');
    expect(stereo).toBeDefined();
    expect(stereo?.name).toBe('Toggle Stereo Power');
    expect(stereo?.category).toBe('power');
    expect(stereo?.endpoints[0].id).toBe('ep_matter_node_1_ep_7');

    const door = homeService.getDevice('matter_node_1_ep_4');
    expect(door).toBeDefined();
    expect(door?.name).toBe('Aqara Door and Window Sensor');

    const leak = homeService.getDevice('matter_node_1_ep_2');
    expect(leak).toBeDefined();
    expect(leak?.name).toBe('Aqara Water Leak Sensor');

    // 3. Verify initial readings
    const initialStereoState = homeService.getEndpointState('ep_matter_node_1_ep_7');
    expect(initialStereoState.state).toBe('off');

    const initialDoorState = homeService.getEndpointState('ep_matter_node_1_ep_4');
    expect(initialDoorState.state).toBe('closed');
    expect(initialDoorState.contact).toBe(true);

    const initialLeakState = homeService.getEndpointState('ep_matter_node_1_ep_2');
    expect(initialLeakState.state).toBe('dry');
    expect(initialLeakState.leak).toBe(false);

    // 4. Test attribute update pushed by server
    const connectedWs = Array.from(wss.clients)[0];
    connectedWs.send(
      JSON.stringify({
        event: 'attribute_updated',
        data: [1, '7/6/0', true], // Toggle Stereo Power turned on
      }),
    );

    await new Promise((r) => setTimeout(r, 60));
    const updatedStereoState = homeService.getEndpointState('ep_matter_node_1_ep_7');
    expect(updatedStereoState.state).toBe('on');
    expect(updatedStereoState.on_off).toBe(true);

    // 5. Test command dispatching
    await homeService.executeDeviceCommand('ep_matter_node_1_ep_7', 'power', 'turn_off');

    expect(receivedCommands).toHaveLength(1);
    expect(receivedCommands[0]).toMatchObject({
      node_id: 1,
      endpoint_id: 7,
      cluster_id: 6,
      command_name: 'Off',
    });

    // Cleanup
    await matterService.onApplicationShutdown();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
