import { describe, expect, it, vi } from 'vitest';
import { RegistryController } from './registry';
import { createDemoSnapshot } from '../model';
import { deviceArea, planDeviceMoves, removeRoom, roomNameInput } from '../model/registry';
import { normalizeHome } from '../model/normalize';

function fixture(mode: 'demo' | 'live' = 'live') {
  let snapshot = createDemoSnapshot();
  let context = { mode, generation: 0, status: 'connected' };
  const request = vi.fn(async (input: Record<string, any>): Promise<any> => {
    if (input.type === 'config/device_registry/list') return structuredClone(snapshot.devices);
    if (input.type === 'config/entity_registry/list') return structuredClone(snapshot.entities);
    if (input.type === 'config/device_registry/update')
      return {
        ...snapshot.devices.find((device) => device.id === input.device_id),
        area_id: input.area_id,
      };
    return {};
  });
  const registry = new RegistryController({
    snapshot: () => snapshot,
    context: () => context,
    commit: (update) => {
      snapshot = update(snapshot);
    },
    request,
  });
  return {
    registry,
    request,
    get snapshot() {
      return snapshot;
    },
    replace: (next: typeof snapshot) => {
      snapshot = next;
    },
    setStatus: (status: string) => {
      context = { ...context, status };
    },
    changeHome: () => {
      context = { ...context, generation: context.generation + 1 };
      snapshot = createDemoSnapshot();
    },
  };
}

describe('room and device organization', () => {
  it('moves and renames the physical scale when its accessory is showing a cached template reading', async () => {
    const f = fixture('demo');
    f.replace({
      ...f.snapshot,
      devices: [{ id: 'scale', name: 'Bedroom Scale', area_id: 'bedroom' }],
      states: [
        {
          entity_id: 'sensor.bedroom_scale_weight',
          state: 'unavailable',
          attributes: { device_class: 'weight', unit_of_measurement: 'kg' },
          last_changed: '',
        },
        {
          entity_id: 'sensor.bedroom_scale_last_weight',
          state: '67.8',
          attributes: { unit_of_measurement: 'kg' },
          last_changed: '',
        },
      ],
      entities: [
        { entity_id: 'sensor.bedroom_scale_weight', device_id: 'scale', platform: 'eufylife_ble' },
        { entity_id: 'sensor.bedroom_scale_last_weight', platform: 'template', area_id: 'bedroom' },
      ],
    });
    await f.registry.updateEntity('sensor.bedroom_scale_last_weight', {
      area_id: 'kitchen',
      name: 'My scales',
    });
    expect(f.snapshot.devices[0]).toMatchObject({ area_id: 'kitchen', name_by_user: 'My scales' });
    expect(f.snapshot.entities[1].device_id).toBeUndefined();
    expect(f.snapshot.entities[1].area_id).toBeNull();
    const accessories = normalizeHome(f.snapshot).accessories;
    expect(accessories).toHaveLength(1);
    expect(accessories[0]).toMatchObject({
      areaId: 'kitchen',
      name: 'My scales',
      deviceId: 'scale',
    });
    expect(f.request).not.toHaveBeenCalled();
  });
  it('runs demo room CRUD locally without any device service commands', async () => {
    const f = fixture('demo');
    const originalStates = f.snapshot.states;
    const room = await f.registry.saveRoom('  Reading   room ');
    expect(room.name).toBe('Reading room');
    await f.registry.saveRoom('Quiet corner', room.area_id);
    expect(f.snapshot.areas.find((area) => area.area_id === room.area_id)?.name).toBe(
      'Quiet corner',
    );
    await f.registry.deleteRoom(room.area_id);
    expect(f.snapshot.areas.some((area) => area.area_id === room.area_id)).toBe(false);
    expect(f.snapshot.states).toBe(originalStates);
    expect(f.request).not.toHaveBeenCalled();
    expect(() => roomNameInput('BEDROOM', f.snapshot.areas)).toThrow('already exists');
  });
  it('rejects non-admin and disconnected changes before touching the registry', async () => {
    const f = fixture();
    f.snapshot.user.is_admin = false;
    await expect(f.registry.saveRoom('Office')).rejects.toThrow('administrator');
    await expect(f.registry.moveDevices([])).rejects.toThrow('administrator');
    f.snapshot.user.is_admin = true;
    f.setStatus('disconnected');
    await expect(f.registry.saveRoom('Office')).rejects.toThrow('Reconnect');
    expect(f.request).not.toHaveBeenCalled();
  });
  it('rolls back an optimistic name on failure without rolling back concurrent live state', async () => {
    const f = fixture();
    const id = f.snapshot.devices[0].id;
    const previous = f.snapshot.devices[0].name_by_user;
    let fail!: (reason: Error) => void;
    f.request.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const operation = f.registry.updateDevice(id, { name_by_user: 'Reading lamp' });
    expect(f.snapshot.devices[0].name_by_user).toBe('Reading lamp');
    f.replace({
      ...f.snapshot,
      config: { ...f.snapshot.config, location_name: 'Updated from HA' },
    });
    fail(new Error('Request rejected'));
    await expect(operation).rejects.toThrow('Request rejected');
    expect(f.snapshot.devices[0].name_by_user).toBe(previous);
    expect(f.snapshot.config.location_name).toBe('Updated from HA');
  });
  it('keeps successful device moves and reports individual failures, without replaying successes on retry', async () => {
    const f = fixture();
    const ids = f.snapshot.devices.slice(0, 3).map((device) => device.id);
    const original = f.request.getMockImplementation()!;
    let rejectSecond = true;
    f.request.mockImplementation(async (input) => {
      if (
        input.type === 'config/device_registry/update' &&
        input.device_id === ids[1] &&
        rejectSecond
      )
        throw new Error('Device update rejected');
      return original(input);
    });
    const results = await f.registry.moveDevices(
      planDeviceMoves(f.snapshot, ids, 'kitchen', false),
    );
    expect(results.map((result) => Boolean(result.error))).toEqual([false, true, false]);
    expect(f.snapshot.devices.find((device) => device.id === ids[0])?.area_id).toBe('kitchen');
    expect(f.snapshot.devices.find((device) => device.id === ids[1])?.area_id).toBe('living_room');
    rejectSecond = false;
    const retry = await f.registry.moveDevices(
      planDeviceMoves(
        f.snapshot,
        results.filter((result) => result.error).map((result) => result.deviceId),
        'kitchen',
        false,
      ),
    );
    expect(retry).toHaveLength(1);
    expect(retry[0].error).toBeUndefined();
    expect(
      f.request.mock.calls.filter(
        ([input]) => input.type === 'config/device_registry/update' && input.device_id === ids[0],
      ),
    ).toHaveLength(1);
    expect(f.request.mock.calls.some(([input]) => input.type === 'call_service')).toBe(false);
  });
  it('keeps individual room overrides unless the reviewed plan explicitly includes them', async () => {
    const f = fixture('demo');
    const device = f.snapshot.devices[0];
    const entity = f.snapshot.entities.find((entry) => entry.device_id === device.id)!;
    entity.area_id = 'bedroom';
    await f.registry.moveDevices(planDeviceMoves(f.snapshot, [device.id], 'kitchen', false));
    expect(f.snapshot.entities.find((entry) => entry.entity_id === entity.entity_id)?.area_id).toBe(
      'bedroom',
    );
    const plan = planDeviceMoves(f.snapshot, [device.id], 'kitchen', true);
    expect(plan[0].overrides).toHaveLength(1);
    await f.registry.moveDevices(plan);
    expect(
      f.snapshot.entities.find((entry) => entry.entity_id === entity.entity_id)?.area_id,
    ).toBeNull();
  });
  it('does not overwrite a room assignment that changed since the preview', async () => {
    const f = fixture();
    const device = f.snapshot.devices[0];
    const plan = planDeviceMoves(f.snapshot, [device.id], 'kitchen', false);
    f.request.mockImplementationOnce(async () =>
      f.snapshot.devices.map((item) =>
        item.id === device.id ? { ...item, area_id: 'bedroom' } : item,
      ),
    );
    const results = await f.registry.moveDevices(plan);
    expect(results[0].error).toContain('changed elsewhere');
    expect(f.request.mock.calls.some(([input]) => input.type.endsWith('/update'))).toBe(false);
  });
  it('never applies a late response from the previous home to a new session', async () => {
    const f = fixture();
    let finish!: (value: any) => void;
    f.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.registry.saveRoom('Office');
    f.changeHome();
    const current = f.snapshot;
    finish({ area_id: 'old_home_office', name: 'Office' });
    await expect(pending).rejects.toThrow('home changed');
    expect(f.snapshot).toBe(current);
  });
  it('does not commit a batch preflight that resolves after switching homes', async () => {
    const f = fixture();
    const plan = planDeviceMoves(f.snapshot, [f.snapshot.devices[0].id], 'kitchen', false);
    let finish!: (value: any) => void;
    const oldDevices = f.snapshot.devices;
    f.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.registry.moveDevices(plan);
    f.changeHome();
    const current = f.snapshot;
    finish(oldDevices);
    await expect(pending).rejects.toThrow('home changed');
    expect(f.snapshot).toBe(current);
    expect(f.request.mock.calls.some(([input]) => input.type.endsWith('/update'))).toBe(false);
  });
  it('understands inherited room assignments, terminates cyclic parents and unassigns only the removed room', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push(
      { id: 'strip', area_id: 'kitchen' },
      { id: 'socket', parent_device_id: 'strip' },
      { id: 'cycle', parent_device_id: 'cycle' },
    );
    expect(deviceArea(snapshot.devices.at(-2)!, snapshot.devices)).toBe('kitchen');
    expect(deviceArea(snapshot.devices.at(-1)!, snapshot.devices)).toBeNull();
    const next = removeRoom(snapshot, 'kitchen');
    expect(
      deviceArea(
        next.devices.find((device) => device.id === 'socket')!,
        next.devices,
      ),
    ).toBeNull();
    expect(next.devices.find((device) => device.area_id === 'bedroom')).toBeDefined();
    expect(next.states).toBe(snapshot.states);
    expect(next.sceneConfigs).toBe(snapshot.sceneConfigs);
  });
});

it('renames a control and moves its physical device in the same update without losing either change', async () => {
  const f = fixture('demo');
  const entry = f.snapshot.entities[0];
  entry.area_id = 'living_room';
  await f.registry.updateEntity(entry.entity_id, { area_id: 'kitchen', name: 'Reading light' });
  expect(f.snapshot.entities.find((item) => item.entity_id === entry.entity_id)).toMatchObject({
    area_id: null,
    name: 'Reading light',
  });
  expect(f.snapshot.devices.find((device) => device.id === entry.device_id)?.area_id).toBe(
    'kitchen',
  );
  expect(f.request).not.toHaveBeenCalled();
});
