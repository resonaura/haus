/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { MatterController, type MatterTransport } from '../src/controller.js';
import { OnOffCluster } from '../src/clusters.js';
import type { MatterAttributeChange } from '../src/types.js';

describe('@haus/matter — Matter Core Protocol Package', () => {
  function createMockTransport() {
    let subscriberCallback: ((change: MatterAttributeChange) => void) | undefined;

    const transport: MatterTransport = {
      commission: vi.fn(async (params) => ({
        nodeId: `node-${params.code ? 'code' : 'disc'}-1`,
        fabricIndex: 1,
      })),
      sendCommand: vi.fn(async () => ({ status: 'success' })),
      readAttribute: vi.fn(async (_nodeId, _ep, clusterId, attrId) => {
        if (clusterId === OnOffCluster.id && attrId === OnOffCluster.attributes.onOff.id)
          return true;
        return undefined;
      }),
      writeAttribute: vi.fn(async () => undefined),
      subscribe: vi.fn((cb) => {
        subscriberCallback = cb;
        return () => {
          subscriberCallback = undefined;
        };
      }),
    };

    return {
      transport,
      simulateChange: (change: MatterAttributeChange) => subscriberCallback?.(change),
    };
  }

  it('commissions a new Matter device and registers it in node inventory', async () => {
    const { transport } = createMockTransport();
    const controller = new MatterController(transport);

    const nodeId = await controller.commission({ code: 'MT:Y.K9042C00KA0648G00' });
    expect(nodeId).toBe('node-code-1');
    expect(transport.commission).toHaveBeenCalledWith({ code: 'MT:Y.K9042C00KA0648G00' });

    const node = controller.getNode(nodeId);
    expect(node).toBeDefined();
    expect(node?.available).toBe(true);
    expect(controller.listNodes()).toHaveLength(1);
  });

  it('rejects commissioning with invalid parameters', async () => {
    const { transport } = createMockTransport();
    const controller = new MatterController(transport);

    await expect(controller.commission({ code: '' })).rejects.toThrow(
      'invalid_matter_commissioning_parameters',
    );
  });

  it('sends cluster commands to commissioned devices', async () => {
    const { transport } = createMockTransport();
    const controller = new MatterController(transport);

    const nodeId = await controller.commission({ code: '12345' });
    const result = await controller.sendCommand(
      nodeId,
      1,
      OnOffCluster.id,
      OnOffCluster.commands.on.id,
    );

    expect(result).toEqual({ status: 'success' });
    expect(transport.sendCommand).toHaveBeenCalledWith(
      nodeId,
      1,
      OnOffCluster.id,
      OnOffCluster.commands.on.id,
      undefined,
    );
  });

  it('reads cluster attributes from nodes', async () => {
    const { transport } = createMockTransport();
    const controller = new MatterController(transport);

    const nodeId = await controller.commission({ code: '12345' });
    const value = await controller.readAttribute(
      nodeId,
      1,
      OnOffCluster.id,
      OnOffCluster.attributes.onOff.id,
    );

    expect(value).toBe(true);
  });

  it('applies attribute change events to node state and notifies subscribers', async () => {
    const { transport, simulateChange } = createMockTransport();
    const controller = new MatterController(transport);

    const nodeId = await controller.commission({ code: '12345' });
    const received: MatterAttributeChange[] = [];
    controller.onAttributeChange((change) => received.push(change));

    // Simulate attribute change from device
    simulateChange({
      nodeId,
      endpointId: 1,
      clusterId: OnOffCluster.id,
      attributeId: OnOffCluster.attributes.onOff.id,
      value: false,
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].value).toBe(false);

    // Verify node internal state was updated
    const node = controller.getNode(nodeId);
    expect(
      node?.endpoints[1]?.clusters[OnOffCluster.id]?.attributes[OnOffCluster.attributes.onOff.id]
        ?.value,
    ).toBe(false);
  });
});
