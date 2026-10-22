import type { Device, HassEntity, Snapshot } from './types';

const key = (value: unknown) =>
  String(value ?? '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const deviceName = (device?: Device) => key(device?.name_by_user || device?.name);

/** Join camera transports and control integrations only on an unambiguous identity. */
export function cameraRelationships(snapshot: Snapshot) {
  const registry = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]));
  const devices = new Map(snapshot.devices.map((device) => [device.id, device]));
  const cameras = snapshot.states.filter((state) => state.entity_id.startsWith('camera.'));
  const ids = new Set(cameras.map((camera) => camera.entity_id));
  const canonical = (camera: HassEntity) =>
    camera.entity_id.endsWith('_internal') && ids.has(camera.entity_id.slice(0, -9))
      ? camera.entity_id.slice(0, -9)
      : camera.entity_id;
  const owners = new Map<string, string>();
  for (const device of snapshot.devices) {
    const direct = cameras.filter(
      (camera) => registry.get(camera.entity_id)?.device_id === device.id,
    );
    const matches = direct.length
      ? direct
      : cameras.filter((camera) => {
          const entry = registry.get(camera.entity_id);
          const owner = devices.get(entry?.device_id ?? '');
          if (
            device.area_id &&
            (entry?.area_id || owner?.area_id) &&
            device.area_id !== (entry?.area_id || owner?.area_id)
          )
            return false;
          const names = [
            deviceName(owner),
            key(camera.attributes.friendly_name),
            key(camera.entity_id.split('.')[1].replace(/_internal$/, '')),
          ];
          return Boolean(deviceName(device) && names.includes(deviceName(device)));
        });
    const candidates = [...new Set(matches.map(canonical))];
    if (candidates.length === 1) owners.set(device.id, candidates[0]);
  }
  const entityOwners = new Map<string, string>();
  for (const state of snapshot.states) {
    const device = registry.get(state.entity_id)?.device_id;
    const owner = device ? owners.get(device) : undefined;
    if (owner) entityOwners.set(state.entity_id, owner);
  }
  const offlineCameraIds = new Set<string>();
  for (const source of cameras) {
    const id = canonical(source);
    if (
      id !== source.entity_id &&
      ['generic', 'proxy', 'template'].includes(registry.get(id)?.platform ?? '') &&
      ['unavailable', 'unknown', 'off'].includes(source.state)
    )
      offlineCameraIds.add(id);
  }
  return { entityOwners, canonicalCameraIds: new Set(cameras.map(canonical)), offlineCameraIds };
}

export function isPowerStrip(device: Device | undefined, members: HassEntity[]) {
  const switches = members.filter((entity) => entity.entity_id.startsWith('switch.'));
  if (switches.length < 2) return false;
  return /power\s*(strip|hub)|surge\s*protector|multi.?socket|mss425|mss620|sw023/i.test(
    `${device?.name_by_user} ${device?.name} ${device?.model}`,
  );
}

export function stripOutlets(accessory: import('./types').HausAccessory) {
  return [accessory.state, ...accessory.secondaryEntities].filter(
    (entity) =>
      entity.entity_id.startsWith('switch.') && !['unavailable', 'unknown'].includes(entity.state),
  );
}
