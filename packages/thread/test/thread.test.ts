/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { ThreadController, type ThreadTransport } from '../src/controller.js';
import { generateDefaultThreadDataset, validateThreadDataset } from '../src/dataset.js';
import type { ThreadDataset, ThreadNetworkState } from '../src/types.js';

describe('@haus/thread — Thread Core Protocol Package', () => {
  const validDataset: ThreadDataset = {
    networkName: 'Haus-Thread',
    channel: 15,
    panId: 0x1234,
    extendedPanId: '1111222233334444',
    networkKey: '00112233445566778899aabbccddeeff',
    meshLocalPrefix: 'fd00:7d03:7d03::/64',
  };

  function createMockTransport() {
    let currentDataset = validDataset;
    const transport: ThreadTransport = {
      setActiveDataset: vi.fn(async (ds) => {
        currentDataset = ds;
      }),
      getActiveDataset: vi.fn(async () => currentDataset),
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      getState: vi.fn(
        async () =>
          ({
            role: 'leader',
            rloc16: '0x3400',
            extAddress: '0x1122334455667788',
            partitionId: 1,
            routerId: 13,
            activeDataset: currentDataset,
            neighborCount: 3,
          }) as ThreadNetworkState,
      ),
      getNeighbors: vi.fn(async () => [
        { rloc16: '0x3401', extAddress: '0xaaaaaaaaaaaaaaaa', lqi: 240, isChild: true, age: 10 },
      ]),
      commission: vi.fn(async () => undefined),
    };

    return { transport, mockFn: transport };
  }

  it('validates and generates random valid Thread operational datasets', () => {
    const generated = generateDefaultThreadDataset('Custom-Mesh');
    const validation = validateThreadDataset(generated);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(validation.dataset?.networkName).toBe('Custom-Mesh');
    expect(validation.dataset?.channel).toBe(15);
  });

  it('rejects invalid Thread dataset parameters', () => {
    expect(validateThreadDataset(null).valid).toBe(false);
    expect(validateThreadDataset({ ...validDataset, channel: 30 }).valid).toBe(false);
    expect(validateThreadDataset({ ...validDataset, panId: -1 }).valid).toBe(false);
    expect(validateThreadDataset({ ...validDataset, networkKey: 'too-short' }).valid).toBe(false);
    expect(
      validateThreadDataset({ ...validDataset, meshLocalPrefix: 'invalid-prefix' }).valid,
    ).toBe(false);
  });

  it('forms and joins Thread network through ThreadController', async () => {
    const { transport } = createMockTransport();
    const controller = new ThreadController(transport);

    await controller.formNetwork(validDataset);
    expect(transport.setActiveDataset).toHaveBeenCalledWith(validDataset);
    expect(transport.attach).toHaveBeenCalled();

    const state = await controller.getNetworkState();
    expect(state.role).toBe('leader');
    expect(state.neighborCount).toBe(3);

    const neighbors = await controller.listNeighbors();
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].isChild).toBe(true);

    await controller.leaveNetwork();
    expect(transport.detach).toHaveBeenCalled();
  });

  it('commissions new Thread end devices with EUI-64 and PSKd', async () => {
    const { transport } = createMockTransport();
    const controller = new ThreadController(transport);

    await controller.commissionDevice('1122334455667788', 'JOINERKEY123');
    expect(transport.commission).toHaveBeenCalledWith('1122334455667788', 'JOINERKEY123');

    await expect(controller.commissionDevice('invalid-eui', 'KEY')).rejects.toThrow(
      'invalid_eui64_identifier',
    );
    await expect(controller.commissionDevice('1122334455667788', '')).rejects.toThrow(
      'invalid_pskd_passphrase',
    );
  });
});
