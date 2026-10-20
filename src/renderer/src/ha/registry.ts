import { roomNameInput, removeRoom, planDeviceMoves, type DeviceMove } from '../model/registry';
import type { Area, Device, EntityRegistryEntry, Snapshot } from '../model';
import { deviceTelemetryRegistry } from '../model/device-telemetry';

type Context = { mode: 'demo' | 'live'; generation: number; status: string };
type Adapter = {
  snapshot: () => Snapshot;
  context: () => Context;
  commit: (update: (snapshot: Snapshot) => Snapshot) => void;
  request: <T>(input: Record<string, unknown>) => Promise<T>;
};
export type MoveResult = { deviceId: string; name: string; error?: string };
export class RegistryController {
  private locks = new Set<string>();
  constructor(private adapter: Adapter) {}
  private scope() {
    const context = this.adapter.context();
    if (!this.adapter.snapshot().user.is_admin)
      throw new Error('An administrator can manage rooms and devices.');
    if (context.mode === 'live' && context.status !== 'connected')
      throw new Error('Reconnect your home before making changes.');
    return context;
  }
  private current(scope: Context) {
    const current = this.adapter.context();
    return current.generation === scope.generation && current.mode === scope.mode;
  }
  private async request<T>(scope: Context, input: Record<string, unknown>): Promise<T> {
    if (!this.current(scope))
      throw new Error('The connected home changed. Review your changes again.');
    const result = await this.adapter.request<T>(input);
    if (!this.current(scope))
      throw new Error('The connected home changed. Review your changes again.');
    return result;
  }
  private async locked<T>(key: string, action: () => Promise<T>) {
    if (this.locks.has(key)) throw new Error('An update is already in progress.');
    this.locks.add(key);
    try {
      return await action();
    } finally {
      this.locks.delete(key);
    }
  }
  async saveRoom(value: string, id?: string): Promise<Area> {
    const scope = this.scope();
    const before = id
      ? this.adapter.snapshot().areas.find((area) => area.area_id === id)
      : undefined;
    if (id && !before) throw new Error('This room no longer exists.');
    const name = roomNameInput(value, this.adapter.snapshot().areas, id);
    return this.locked(`area:${id ?? 'new'}`, async () => {
      if (before)
        this.adapter.commit((snapshot) => ({
          ...snapshot,
          areas: snapshot.areas.map((area) => (area.area_id === id ? { ...area, name } : area)),
        }));
      try {
        const area =
          scope.mode === 'demo'
            ? { ...before, area_id: id ?? `demo_${crypto.randomUUID()}`, name }
            : await this.request<Area>(scope, {
                type: `config/area_registry/${id ? 'update' : 'create'}`,
                ...(id ? { area_id: id } : {}),
                name,
              });
        if (this.current(scope))
          this.adapter.commit((snapshot) => ({
            ...snapshot,
            areas: [...snapshot.areas.filter((item) => item.area_id !== area.area_id), area],
          }));
        return area;
      } catch (error) {
        if (before && this.current(scope))
          this.adapter.commit((snapshot) => ({
            ...snapshot,
            areas: snapshot.areas.map((area) =>
              area.area_id === id && area.name === name ? { ...area, name: before.name } : area,
            ),
          }));
        throw error;
      }
    });
  }
  async deleteRoom(id: string) {
    const scope = this.scope();
    if (!this.adapter.snapshot().areas.some((area) => area.area_id === id))
      throw new Error('This room no longer exists.');
    return this.locked(`area:${id}`, async () => {
      if (scope.mode === 'live')
        await this.request(scope, { type: 'config/area_registry/delete', area_id: id });
      if (this.current(scope)) this.adapter.commit((snapshot) => removeRoom(snapshot, id));
    });
  }
  async updateDevice(id: string, patch: { name_by_user?: string | null; area_id?: string | null }) {
    return this.updateDeviceInScope(this.scope(), id, patch);
  }
  async updateEntity(id: string, patch: { name?: string; area_id?: string | null }) {
    const scope = this.scope();
    const before = this.adapter.snapshot().entities.find((entry) => entry.entity_id === id);
    if (!before) throw new Error('This control does not have editable home settings.');
    const ownership = deviceTelemetryRegistry(this.adapter.snapshot());
    const deviceId = ownership.get(id)?.device_id;
    if (patch.name !== undefined) {
      patch = { ...patch, name: patch.name.replace(/\s+/g, ' ').trim() };
      if (!patch.name || patch.name.length > 150)
        throw new Error('Use a name between 1 and 150 characters.');
    }
    if (patch.area_id !== undefined && deviceId) {
      const snapshot = this.adapter.snapshot();
      const plan = planDeviceMoves(
        {
          ...snapshot,
          entities: snapshot.entities.map((entry) => ({
            ...entry,
            device_id: ownership.get(entry.entity_id)?.device_id ?? entry.device_id,
          })),
        },
        [deviceId],
        patch.area_id,
        true,
      );
      if (plan.length) {
        const results = await this.moveDevices(plan);
        if (results[0]?.error) throw new Error(results[0].error);
      }
      const { area_id: _area, ...rest } = patch;
      patch = rest;
    }
    // A cached template reading belongs to the scale; accessory edits must target that physical owner.
    if (!before.device_id && deviceId && patch.name !== undefined) {
      await this.updateDeviceInScope(scope, deviceId, { name_by_user: patch.name });
      const { name: _name, ...rest } = patch;
      patch = rest;
    }
    if (
      patch.area_id &&
      !this.adapter.snapshot().areas.some((area) => area.area_id === patch.area_id)
    )
      throw new Error('This room no longer exists.');
    if (!Object.keys(patch).length) return;
    return this.locked(`entity:${id}`, async () => {
      if (!this.current(scope)) throw new Error('The connected home changed.');
      this.adapter.commit((snapshot) => ({
        ...snapshot,
        entities: snapshot.entities.map((entry) =>
          entry.entity_id === id ? { ...entry, ...patch } : entry,
        ),
      }));
      try {
        if (scope.mode === 'live')
          await this.request(scope, {
            type: 'config/entity_registry/update',
            entity_id: id,
            ...patch,
          });
      } catch (error) {
        if (this.current(scope))
          this.adapter.commit((snapshot) => ({
            ...snapshot,
            entities: snapshot.entities.map((entry) =>
              entry.entity_id !== id
                ? entry
                : {
                    ...entry,
                    ...Object.fromEntries(
                      Object.entries(patch)
                        .filter(([key, value]) => entry[key] === value)
                        .map(([key]) => [key, before[key]]),
                    ),
                  },
            ),
          }));
        throw error;
      }
    });
  }
  private async updateDeviceInScope(
    scope: Context,
    id: string,
    patch: { name_by_user?: string | null; area_id?: string | null },
  ) {
    if (patch.name_by_user !== undefined && patch.name_by_user !== null) {
      patch = { ...patch, name_by_user: patch.name_by_user.replace(/\s+/g, ' ').trim() };
      if (!patch.name_by_user || patch.name_by_user.length > 150)
        throw new Error('Use a device name between 1 and 150 characters.');
    }
    const snapshot = this.adapter.snapshot();
    const before = snapshot.devices.find((device) => device.id === id);
    if (!before) throw new Error('This device no longer exists.');
    if (patch.area_id && !snapshot.areas.some((area) => area.area_id === patch.area_id))
      throw new Error('This room no longer exists.');
    return this.locked(`device:${id}`, async () => {
      if (!this.current(scope)) throw new Error('The connected home changed.');
      this.adapter.commit((snapshot) => ({
        ...snapshot,
        devices: snapshot.devices.map((device) =>
          device.id === id ? { ...device, ...patch } : device,
        ),
      }));
      try {
        const result =
          scope.mode === 'demo'
            ? { ...before, ...patch }
            : await this.request<Device>(scope, {
                type: 'config/device_registry/update',
                device_id: id,
                ...patch,
              });
        if (this.current(scope))
          this.adapter.commit((snapshot) => ({
            ...snapshot,
            devices: snapshot.devices.map((device) =>
              device.id === id ? { ...device, ...result } : device,
            ),
          }));
      } catch (error) {
        if (this.current(scope))
          this.adapter.commit((snapshot) => ({
            ...snapshot,
            devices: snapshot.devices.map((device) =>
              device.id !== id
                ? device
                : {
                    ...device,
                    ...Object.fromEntries(
                      Object.entries(patch)
                        .filter(([key, value]) => device[key] === value)
                        .map(([key]) => [key, before[key]]),
                    ),
                  },
            ),
          }));
        throw error;
      }
    });
  }
  async moveDevices(
    plan: DeviceMove[],
    progress?: (done: number, total: number) => void,
  ): Promise<MoveResult[]> {
    const scope = this.scope();
    if (scope.mode === 'live') {
      const [devices, entities] = await Promise.all([
        this.request<Device[]>(scope, { type: 'config/device_registry/list' }),
        this.request<EntityRegistryEntry[]>(scope, { type: 'config/entity_registry/list' }),
      ]);
      if (!this.current(scope)) throw new Error('The connected home changed.');
      this.adapter.commit((snapshot) => ({ ...snapshot, devices, entities }));
    }
    const results: MoveResult[] = [];
    for (const item of plan) {
      try {
        if (!this.current(scope)) throw new Error('The connected home changed.');
        const snapshot = this.adapter.snapshot();
        const device = snapshot.devices.find((device) => device.id === item.deviceId);
        if (
          !device ||
          (device.area_id ?? null) !== item.fromAreaId ||
          item.overrides.some(
            (override) =>
              snapshot.entities.find((entry) => entry.entity_id === override.entityId)?.area_id !==
              override.fromAreaId,
          )
        )
          throw new Error('The room assignment changed elsewhere. Review it before retrying.');
        if (item.toAreaId !== item.fromAreaId)
          await this.updateDeviceInScope(scope, item.deviceId, { area_id: item.toAreaId });
        for (const override of item.overrides) {
          if (scope.mode === 'live')
            await this.request(scope, {
              type: 'config/entity_registry/update',
              entity_id: override.entityId,
              area_id: null,
            });
          if (!this.current(scope)) throw new Error('The connected home changed.');
          this.adapter.commit((snapshot) => ({
            ...snapshot,
            entities: snapshot.entities.map((entry) =>
              entry.entity_id === override.entityId ? { ...entry, area_id: null } : entry,
            ),
          }));
        }
        results.push({ deviceId: item.deviceId, name: item.name });
      } catch (error) {
        results.push({
          deviceId: item.deviceId,
          name: item.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      progress?.(results.length, plan.length);
    }
    return results;
  }
}
