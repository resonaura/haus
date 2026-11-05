/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import {
  CommandCoalescingQueue,
  DeadbandFilter,
  DEVICE_CATEGORIES,
  assertDeviceCategory,
  celsiusToFahrenheit,
  createOAuthFlow,
  createReauthFlow,
  createTwoFactorFlow,
  fahrenheitToCelsius,
  isDeviceCategory,
  kelvinToMireds,
  miredsToKelvin,
  normalizeHaEntity,
  normalizeHsv,
} from '../src/device/index.js';
import type { HausDevice, HausEndpoint } from '../src/device/index.js';

describe('Haus Unified Device & Entity Standard', () => {
  describe('Device Categories', () => {
    it('validates all canonical categories', () => {
      expect(DEVICE_CATEGORIES.length).toBe(16);
      expect(isDeviceCategory('lighting')).toBe(true);
      expect(isDeviceCategory('power')).toBe(true);
      expect(isDeviceCategory('climate')).toBe(true);
      expect(isDeviceCategory('security')).toBe(true);
      expect(isDeviceCategory('network')).toBe(true);
      expect(isDeviceCategory('compute')).toBe(true);
      expect(isDeviceCategory('storage')).toBe(true);
      expect(isDeviceCategory('energy')).toBe(true);
      expect(isDeviceCategory('appliances')).toBe(true);
      expect(isDeviceCategory('generic')).toBe(true);
      expect(isDeviceCategory('nonexistent_category')).toBe(false);
    });

    it('asserts valid categories and throws on invalid', () => {
      expect(() => assertDeviceCategory('lighting')).not.toThrow();
      expect(() => assertDeviceCategory('invalid_category')).toThrow('invalid_device_category');
    });
  });

  describe('Capability Conversions & Units', () => {
    it('converts Kelvin to HomeKit Mireds and back without precision degradation', () => {
      expect(kelvinToMireds(2700)).toBe(370);
      expect(miredsToKelvin(370)).toBe(2703); // Within 3K tolerance

      expect(kelvinToMireds(6500)).toBe(154);
      expect(miredsToKelvin(154)).toBe(6494);

      // Clamp limits
      expect(kelvinToMireds(1000)).toBe(500); // Clamped max
      expect(kelvinToMireds(10000)).toBe(140); // Clamped min
    });

    it('normalizes HSV values within standard ranges', () => {
      const norm1 = normalizeHsv(370, 150, -10);
      expect(norm1).toEqual({ hue: 10, saturation: 100, value: 0 });

      const norm2 = normalizeHsv(-30, 50, 80);
      expect(norm2).toEqual({ hue: 330, saturation: 50, value: 80 });
    });

    it('converts Celsius and Fahrenheit accurately', () => {
      expect(celsiusToFahrenheit(0)).toBe(32);
      expect(celsiusToFahrenheit(21.5)).toBe(70.7);
      expect(fahrenheitToCelsius(70.7)).toBe(21.5);
    });
  });

  describe('3-Tier Hierarchy & Multi-Gang Endpoint Independence', () => {
    it('models physical device with endpoints in independent rooms', () => {
      const socket1: HausEndpoint = {
        id: 'socket-1',
        address: 'switch::bedroom:power-strip:socket-1',
        roomId: 'room-bedroom',
        name: 'Desk Lamp Socket',
        category: 'power',
        capabilities: [
          {
            id: 'on_off',
            kind: 'on_off',
            readable: true,
            operations: ['turn_on', 'turn_off'],
          },
        ],
        readings: {
          on_off: { value: true, freshness: 'live' },
        },
      };

      const socket2: HausEndpoint = {
        id: 'socket-2',
        address: 'switch::office:power-strip:socket-2',
        roomId: 'room-office',
        name: 'Monitor Socket',
        category: 'power',
        capabilities: [
          {
            id: 'on_off',
            kind: 'on_off',
            readable: true,
            operations: ['turn_on', 'turn_off'],
          },
        ],
        readings: {
          on_off: { value: false, freshness: 'live' },
        },
      };

      const surgeProtector: HausDevice = {
        id: 'dev-powerstrip-1',
        source: { instanceId: 'zigbee-coordinator', externalId: '0x00158d0001' },
        name: 'Smart 2-Gang Surge Protector',
        category: 'power',
        manufacturer: 'Aqara',
        model: 'SP-E01',
        connectivity: { protocol: 'zigbee', lqi: 240 },
        availability: 'online',
        endpoints: [socket1, socket2],
      };

      expect(surgeProtector.endpoints.length).toBe(2);
      expect(surgeProtector.endpoints[0].roomId).toBe('room-bedroom');
      expect(surgeProtector.endpoints[1].roomId).toBe('room-office');
      expect(surgeProtector.endpoints[0].address).toBe('switch::bedroom:power-strip:socket-1');
    });

    it('attaches custom extensible entities alongside standard capabilities', () => {
      const routerDevice: HausDevice = {
        id: 'dev-router-1',
        source: { instanceId: 'network-monitor', externalId: 'eero-gateway' },
        name: 'Core Mesh Gateway',
        category: 'network',
        manufacturer: 'eero',
        connectivity: { protocol: 'local_ip', address: '192.168.4.1' },
        availability: 'online',
        endpoints: [
          {
            id: 'gateway',
            name: 'Gateway Ports',
            category: 'network',
            capabilities: [],
            readings: {},
            customEntities: {
              poe_port_1: {
                id: 'poe_port_1',
                name: 'PoE Port 1 Power',
                primitive: 'toggle',
                reading: { value: true, freshness: 'live' },
              },
              uplink_bandwidth: {
                id: 'uplink_bandwidth',
                name: 'Uplink Throughput',
                primitive: 'gauge',
                unit: 'Mbps',
                min: 0,
                max: 1000,
                reading: { value: 940.5, freshness: 'live' },
              },
            },
          },
        ],
      };

      const custom = routerDevice.endpoints[0].customEntities;
      expect(custom?.poe_port_1.primitive).toBe('toggle');
      expect(custom?.uplink_bandwidth.primitive).toBe('gauge');
      expect(custom?.uplink_bandwidth.unit).toBe('Mbps');
    });
  });

  describe('Deadband Filter & Telemetry Throttling', () => {
    it('filters small telemetry fluctuations below minDelta', () => {
      const filter = new DeadbandFilter({ minDelta: 1.0 });

      expect(filter.shouldEmit(100.0, 1000)).toBe(true); // Initial
      expect(filter.shouldEmit(100.4, 1100)).toBe(false); // Delta 0.4 < 1.0
      expect(filter.shouldEmit(100.9, 1200)).toBe(false); // Delta 0.9 < 1.0
      expect(filter.shouldEmit(101.5, 1300)).toBe(true); // Delta 1.5 >= 1.0
    });

    it('enforces minInterval rate limiting', () => {
      const filter = new DeadbandFilter({ minIntervalMs: 500 });

      expect(filter.shouldEmit(10.0, 1000)).toBe(true);
      expect(filter.shouldEmit(20.0, 1200)).toBe(false); // Only 200ms elapsed
      expect(filter.shouldEmit(30.0, 1500)).toBe(true); // 500ms elapsed
    });

    it('forces heartbeat emission after maxQuietInterval', () => {
      const filter = new DeadbandFilter({ minDelta: 5.0, maxQuietIntervalMs: 5000 });

      expect(filter.shouldEmit(50.0, 1000)).toBe(true);
      expect(filter.shouldEmit(50.1, 2000)).toBe(false);
      expect(filter.shouldEmit(50.2, 5999)).toBe(false);
      expect(filter.shouldEmit(50.2, 6001)).toBe(true); // 5001ms elapsed >= 5000ms
    });
  });

  describe('Command Coalescing Queue', () => {
    it('coalesces rapid sequential commands targeting the same endpoint and capability', () => {
      const queue = new CommandCoalescingQueue<{
        endpointId: string;
        capabilityId: string;
        op: string;
      }>();

      queue.enqueue({ endpointId: 'ep-1', capabilityId: 'on_off', op: 'turn_on' });
      queue.enqueue({ endpointId: 'ep-1', capabilityId: 'on_off', op: 'turn_off' });
      queue.enqueue({ endpointId: 'ep-1', capabilityId: 'on_off', op: 'turn_on' });

      // Target different endpoint
      queue.enqueue({ endpointId: 'ep-2', capabilityId: 'on_off', op: 'turn_off' });

      expect(queue.size()).toBe(2);

      const first = queue.dequeue();
      expect(first).toEqual({ endpointId: 'ep-1', capabilityId: 'on_off', op: 'turn_on' });

      const second = queue.dequeue();
      expect(second).toEqual({ endpointId: 'ep-2', capabilityId: 'on_off', op: 'turn_off' });

      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe('Interactive Flows', () => {
    it('generates 2FA flow step with countdown', () => {
      const flow = createTwoFactorFlow('flow-123', 'Ring Doorbell', 60);
      expect(flow.type).toBe('form');
      expect(flow.step).toBe('2fa');
      expect(flow.countdownSeconds).toBe(60);
      expect(flow.fields?.[0].type).toBe('pin');
    });

    it('generates OAuth flow step', () => {
      const flow = createOAuthFlow(
        'flow-456',
        'Spotify',
        'https://accounts.spotify.com/authorize',
        'haus://auth/callback',
      );
      expect(flow.type).toBe('oauth');
      expect(flow.oauthUrl).toContain('spotify');
      expect(flow.returnUrl).toBe('haus://auth/callback');
    });

    it('generates non-destructive reauth flow', () => {
      const flow = createReauthFlow('flow-789', 'Eufy Security', [
        { name: 'password', type: 'string', label: 'Password' },
      ]);
      expect(flow.type).toBe('reauth');
      expect(flow.title).toContain('Re-authenticate');
    });
  });

  describe('Legacy HA Normalization', () => {
    it('normalizes HA light with brightness and Kelvin color temperature', () => {
      const { endpoint, category } = normalizeHaEntity({
        entity_id: 'light.living_room_ceiling',
        state: 'on',
        attributes: {
          friendly_name: 'Living Room Ceiling',
          brightness: 128,
          color_temp_kelvin: 3000,
        },
      });

      expect(category).toBe('lighting');
      expect(endpoint.name).toBe('Living Room Ceiling');
      expect(endpoint.readings.on_off.value).toBe(true);
      expect(endpoint.readings.brightness.value).toBe(50); // 128 / 255 = ~50%
      expect(endpoint.readings.color_temp.value).toBe(3000);
    });

    it('normalizes HA event entity from Hue Wall Switch or Tap Dial', () => {
      const { endpoint, category } = normalizeHaEntity({
        entity_id: 'event.bedroom_wall_switch_button_1',
        state: 'press',
        attributes: {
          event_type: 'press',
          event_types: ['press', 'double_press', 'long_press'],
        },
      });

      expect(category).toBe('power');
      expect(endpoint.capabilities.some((c) => c.kind === 'event')).toBe(true);
      const eventReading = endpoint.readings.event.value as { eventType: string };
      expect(eventReading.eventType).toBe('press');
    });

    it('normalizes HA climate entity with current and target temperature', () => {
      const { endpoint, category } = normalizeHaEntity({
        entity_id: 'climate.bedroom_ac',
        state: 'cool',
        attributes: {
          current_temperature: 23.5,
          temperature: 21.0,
        },
      });

      expect(category).toBe('climate');
      expect(endpoint.readings.current_temperature.value).toBe(23.5);
      expect(endpoint.readings.target_temperature.value).toBe(21.0);
    });

    it('normalizes HA binary sensor for motion', () => {
      const { endpoint, category } = normalizeHaEntity({
        entity_id: 'binary_sensor.hallway_motion',
        state: 'on',
        attributes: {
          device_class: 'motion',
        },
      });

      expect(category).toBe('occupancy_sensors');
      expect(endpoint.readings.motion.value).toBe(true);
    });

    it('normalizes HA update entity', () => {
      const { endpoint, category } = normalizeHaEntity({
        entity_id: 'update.esphome_plug',
        state: 'on',
        attributes: {
          installed_version: '2024.1.0',
          latest_version: '2024.2.0',
          in_progress: false,
        },
      });

      expect(category).toBe('generic');
      const updateReading = endpoint.readings.update.value as {
        installedVersion: string;
        latestVersion: string;
      };
      expect(updateReading.installedVersion).toBe('2024.1.0');
      expect(updateReading.latestVersion).toBe('2024.2.0');
    });
  });
});
