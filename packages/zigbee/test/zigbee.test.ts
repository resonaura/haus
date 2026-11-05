/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { ZigbeeCoordinator, type ZigbeeTransport } from '../src/coordinator.js';
import { Clusters } from '../src/clusters.js';
import type { ZigbeeDeviceEvent } from '../src/types.js';

describe('@haus/zigbee — Zigbee Core Protocol Package', () => {
  const ieee = '0x00124b0024c12345';

  function createMockTransport() {
    let subscriberCallback: ((event: ZigbeeDeviceEvent) => void) | undefined;

    const transport: ZigbeeTransport = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      permitJoin: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({ status: 'SUCCESS' })),
      readAttribute: vi.fn(async (_ieee, _ep, clusterId, attrId) => {
        if (
          clusterId === Clusters.genOnOff.ID &&
          attrId === Clusters.genOnOff.attributes.onOff.ID
        ) {
          return 1;
        }
        return undefined;
      }),
      subscribe: vi.fn((cb) => {
        subscriberCallback = cb;
        return () => {
          subscriberCallback = undefined;
        };
      }),
    };

    return {
      transport,
      simulateEvent: (event: ZigbeeDeviceEvent) => subscriberCallback?.(event),
    };
  }

  it('starts coordinator with valid serial port and channel', async () => {
    const { transport } = createMockTransport();
    const coordinator = new ZigbeeCoordinator(transport);

    await coordinator.start({ serialPort: '/dev/ttyUSB0', channel: 15 });
    expect(coordinator.running).toBe(true);
    expect(transport.start).toHaveBeenCalledWith({ serialPort: '/dev/ttyUSB0', channel: 15 });

    await coordinator.stop();
    expect(coordinator.running).toBe(false);
  });

  it('validates coordinator configuration parameters', async () => {
    const { transport } = createMockTransport();
    const coordinator = new ZigbeeCoordinator(transport);

    await expect(coordinator.start({ serialPort: '' })).rejects.toThrow('serial_port_required');
    await expect(coordinator.start({ serialPort: '/dev/ttyUSB0', channel: 5 })).rejects.toThrow(
      'invalid_zigbee_channel',
    );
  });

  it('enables permit join for device pairing', async () => {
    const { transport } = createMockTransport();
    const coordinator = new ZigbeeCoordinator(transport);

    await coordinator.start({ serialPort: '/dev/ttyUSB0' });
    await coordinator.permitJoin(60);
    expect(transport.permitJoin).toHaveBeenCalledWith(60);

    await expect(coordinator.permitJoin(300)).rejects.toThrow('invalid_permit_join_duration');
  });

  it('registers devices and dispatches ZCL cluster commands', async () => {
    const { transport } = createMockTransport();
    const coordinator = new ZigbeeCoordinator(transport);
    await coordinator.start({ serialPort: '/dev/ttyUSB0' });

    coordinator.registerDevice({
      ieeeAddress: ieee,
      networkAddress: 0x1234,
      manufacturerName: 'IKEA',
      modelId: 'TRADFRI bulb',
      available: true,
      endpoints: {},
    });

    expect(coordinator.listDevices()).toHaveLength(1);
    const result = await coordinator.sendCommand(
      ieee,
      1,
      Clusters.genOnOff.ID,
      Clusters.genOnOff.commands.on.ID,
    );
    expect(result).toEqual({ status: 'SUCCESS' });
    expect(transport.sendCommand).toHaveBeenCalledWith(
      ieee,
      1,
      Clusters.genOnOff.ID,
      Clusters.genOnOff.commands.on.ID,
      undefined,
    );
  });

  it('applies incoming device events and notifies subscribers', async () => {
    const { transport, simulateEvent } = createMockTransport();
    const coordinator = new ZigbeeCoordinator(transport);
    await coordinator.start({ serialPort: '/dev/ttyUSB0' });

    coordinator.registerDevice({
      ieeeAddress: ieee,
      networkAddress: 0x1234,
      available: true,
      endpoints: {},
    });

    const received: ZigbeeDeviceEvent[] = [];
    coordinator.onDeviceEvent((e) => received.push(e));

    simulateEvent({
      ieeeAddress: ieee,
      endpointId: 1,
      clusterId: Clusters.genOnOff.ID,
      attributeId: Clusters.genOnOff.attributes.onOff.ID,
      value: 1,
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].value).toBe(1);

    const device = coordinator.getDevice(ieee);
    expect(
      device?.endpoints[1]?.clusters[Clusters.genOnOff.ID]?.attributes[
        Clusters.genOnOff.attributes.onOff.ID
      ]?.value,
    ).toBe(1);
  });
});
