import type { Device, EntityRegistryEntry, HassEntity, Snapshot } from './types';
import { attachKettleRegistry } from './kettle-identity';

/** These integrations expose playback sessions, not a new physical speaker for each client. */
export function isSoftwareMediaEndpoint(entity: HassEntity, entry?: EntityRegistryEntry) {
  return (
    entity.entity_id.startsWith('media_player.') &&
    ['jellyfin', 'plex', 'emby', 'browser_mod'].includes(entry?.platform ?? '')
  );
}

const massUnits = new Set(['kg', 'g', 'lb', 'lbs', 'oz', 'st']);
const massUnit = (state: HassEntity) =>
  String(state.attributes.unit_of_measurement ?? '').toLowerCase();
export function isScaleReading(state: HassEntity, device?: Device) {
  return (
    state.entity_id.startsWith('sensor.') &&
    massUnits.has(massUnit(state)) &&
    (state.attributes.device_class === 'weight' ||
      /\bscales?\b|весы/i.test(`${device?.name} ${device?.model}`))
  );
}

/** Presentation-only registry: never change HA's template, entity ID or explicit room assignment. */
export function deviceTelemetryRegistry(snapshot: Snapshot) {
  const registry = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]));
  attachKettleRegistry(snapshot, registry);
  const states = new Map(snapshot.states.map((state) => [state.entity_id, state]));
  const devices = new Map(snapshot.devices.map((device) => [device.id, device]));
  for (const state of snapshot.states) {
    const entry = registry.get(state.entity_id);
    if (
      entry?.platform !== 'template' ||
      entry.device_id ||
      entry.disabled_by ||
      !state.entity_id.startsWith('sensor.') ||
      !state.entity_id.endsWith('_last_weight')
    )
      continue;
    // An exact entity lineage plus a physical mass sensor is required; similar display names are insufficient.
    const source = states.get(state.entity_id.replace(/_last_weight$/, '_weight'));
    const sourceEntry = source && registry.get(source.entity_id);
    const device = devices.get(sourceEntry?.device_id ?? '');
    const area = sourceEntry?.area_id || device?.area_id;
    if (
      !source ||
      !device ||
      !isScaleReading(source, device) ||
      massUnit(source) !== massUnit(state) ||
      sourceEntry?.platform === 'template' ||
      (entry.area_id && entry.area_id !== area)
    )
      continue;
    registry.set(state.entity_id, {
      ...entry,
      device_id: device.id,
      area_id: entry.area_id || sourceEntry?.area_id,
    });
  }
  return registry;
}

const scaleReadingRank = (state: HassEntity) =>
  state.entity_id.endsWith('_last_weight')
    ? 1
    : /(?:real_time|non_stabilized)/.test(state.entity_id)
      ? 2
      : 0;
/** Device identity never follows availability or a cached sensor becoming the newest value. */
export function preferredScaleEntity(candidates: HassEntity[], device?: Device) {
  return candidates
    .filter((state) => isScaleReading(state, device))
    .sort(
      (a, b) => scaleReadingRank(a) - scaleReadingRank(b) || a.entity_id.localeCompare(b.entity_id),
    )[0];
}
export function knownScaleReading(candidates: HassEntity[], device?: Device) {
  return preferredScaleEntity(
    candidates.filter((state) => state.state.trim() && Number.isFinite(Number(state.state))),
    device,
  );
}
