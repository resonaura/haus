import type { HassEntity, Snapshot } from './types';

/** Only Haus MQTT identities may replace explicitly linked raw camera sensors. */
export function cameraActivities(snapshot: Snapshot) {
  const registry = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]));
  const ids = new Set(snapshot.states.map((state) => state.entity_id));
  const sensors = new Map<string, HassEntity>();
  const replaced = new Set<string>();
  for (const state of snapshot.states) {
    const entry = registry.get(state.entity_id);
    const camera = state.attributes.haus_camera;
    if (
      !state.entity_id.startsWith('binary_sensor.') ||
      entry?.platform !== 'mqtt' ||
      !/^haus_activity_[a-f0-9]{20}$/.test(entry.unique_id ?? '') ||
      entry.disabled_by ||
      entry.hidden_by ||
      state.attributes.haus_activity_version !== 1 ||
      typeof camera !== 'string' ||
      !camera.startsWith('camera.') ||
      !ids.has(camera) ||
      sensors.has(camera)
    )
      continue;
    sensors.set(camera, state);
    const sources = state.attributes.native_sources;
    if (Array.isArray(sources))
      for (const source of sources.slice(0, 32))
        if (
          typeof source === 'string' &&
          /^(binary_sensor|event)\./.test(source) &&
          ids.has(source)
        )
          replaced.add(source);
  }
  return { sensors, replaced };
}
