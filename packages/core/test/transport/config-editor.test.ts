/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import {
  buildRoomDeviceCandidates,
  cutoverHaAutomation,
  deleteEditableConfig,
  editableConfigPath,
  mergeRoomIcons,
  resolveRoomIconName,
  saveEditableConfig,
  validateEditableConfig,
  type ManagementPort,
  type ManagementRequest,
} from '../../src/transport/index.js';

describe('@haus/core transport config-editor & rooms helpers', () => {
  it('validates editable config paths and payloads', () => {
    expect(editableConfigPath('scene', 'evening_1')).toBe('config/scene/config/evening_1');
    expect(() => editableConfigPath('automation', '../secret')).toThrow(/editable configuration/i);

    expect(() => validateEditableConfig('scene', { name: '  ', entities: { 'light.a': 'on' } })).toThrow(
      'Give this item a name.',
    );
    expect(() => validateEditableConfig('scene', { name: 'Cozy', entities: {} })).toThrow(
      'Add at least one accessory to the scene.',
    );
    expect(() =>
      validateEditableConfig('automation', { alias: 'Motion light', triggers: [], actions: [] }),
    ).toThrow('Add a trigger and an action.');
    expect(
      validateEditableConfig('scene', { name: ' Cozy ', entities: { 'light.a': { state: 'on' } } }),
    ).toBe('Cozy');
  });

  it('detects remote conflicts and supports save, delete, and HA automation cutover', async () => {
    const calls: ManagementRequest[] = [];
    const port: ManagementPort = {
      async management<T = unknown>(req: ManagementRequest): Promise<T> {
        calls.push(req);
        if (req.method === 'GET') {
          return { name: 'Updated externally', entities: { 'light.a': 'off' } } as T;
        }
        if (req.path === 'haus/rules/automations/cutover') {
          return {
            automation: { enabled: true, metadata: { migration: { cutoverAt: '2026-11-24T00:00:00Z' } } },
          } as T;
        }
        return {} as T;
      },
    };

    await expect(
      saveEditableConfig(
        port,
        'scene',
        'evening_1',
        { name: 'Cozy', entities: { 'light.a': 'on' } },
        { name: 'Cozy', entities: { 'light.a': 'on' } },
      ),
    ).rejects.toThrow(/changed remotely/i);

    calls.length = 0;
    await saveEditableConfig(port, 'scene', 'evening_2', {
      name: '  Cozy  ',
      entities: { 'light.a': 'on' },
    });
    expect(calls[0]).toEqual({
      method: 'POST',
      path: 'config/scene/config/evening_2',
      data: { name: 'Cozy', entities: { 'light.a': 'on' } },
    });

    await deleteEditableConfig(port, 'scene', 'evening_2');
    expect(calls[1]).toEqual({ method: 'DELETE', path: 'config/scene/config/evening_2' });

    await expect(cutoverHaAutomation(port, 'rule-1', 'automation.old')).resolves.toBeUndefined();
    const failPort: ManagementPort = {
      async management<T = unknown>(): Promise<T> {
        return { automation: { enabled: false } } as T;
      },
    };
    await expect(cutoverHaAutomation(failPort, 'rule-1', 'automation.old')).rejects.toThrow(
      'cutover_verification_failed',
    );
  });

  it('merges room icons and sorts unassigned room device candidates first', () => {
    const areas = [
      { area_id: 'living', name: 'Living Room', icon: 'living' },
      { area_id: 'kitchen', name: 'Kitchen' },
    ];
    expect(mergeRoomIcons(areas, { kitchen: 'kitchen' })).toEqual({
      living: 'living',
      kitchen: 'kitchen',
    });
    expect(resolveRoomIconName('Kitchen', 'tv')).toBe('tv');
    expect(resolveRoomIconName('Kitchen', 'auto')).toBe('utensils');

    const spy = vi.fn((device: { readonly area_id?: string | null }) => device.area_id ?? null);
    const candidates = buildRoomDeviceCandidates(
      [
        { id: 'd2', area_id: 'kitchen', name: 'Kettle', manufacturer: 'Fellow', model: 'Stagg' },
        { id: 'd1', area_id: 'living', name: 'Sofa lamp' },
        { id: 'd3', area_id: null, name_by_user: 'Desk Sensor 2' },
        { id: 'd4', area_id: null, name: 'Desk Sensor 10' },
      ],
      areas,
      spy,
      'living',
    );
    expect(candidates.map((c) => c.id)).toEqual(['d3', 'd4', 'd2']);
    expect(candidates[0].currentRoomName).toBe('Unassigned');
    expect(candidates[2].detail).toBe('Fellow · Stagg');
  });
});
