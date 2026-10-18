import type { HausNative } from '../../../shared/native';
import type { Snapshot } from '../model/types';
import { lightColor } from '../model/light-color';
import { scenePresentation } from '../model/scene-presentation';

const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const records = (value: unknown): Array<Record<string, any>> =>
  Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : [];
const normalized = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase();

function hueColor(value: unknown): string | undefined {
  const action = record(value);
  const xy = record(record(action.color).xy);
  const mirek = record(action.color_temperature).mirek;
  const attributes =
    Number.isFinite(xy.x) && Number.isFinite(xy.y)
      ? { xy_color: [xy.x, xy.y] }
      : typeof mirek === 'number' && mirek > 0
        ? { color_temp: mirek }
        : undefined;
  return attributes
    ? lightColor({ entity_id: 'light.hue_preview', state: 'on', attributes, last_changed: '' })
    : undefined;
}

/** Retain only scene artwork; bridge diagnostics never enter persistent preferences. */
export function hueSceneArtwork(
  snapshot: Snapshot,
  configEntryId: string,
  diagnostics: unknown,
): NonNullable<Snapshot['sceneArtwork']> {
  const resources = records(record(record(diagnostics).data).full_state);
  const groups = new Map(
    resources
      .filter((resource) => ['room', 'zone'].includes(resource.type))
      .map((resource) => [resource.id, record(resource.metadata).name]),
  );
  const scenes = resources.filter((resource) => resource.type === 'scene');
  const result: NonNullable<Snapshot['sceneArtwork']> = {};
  for (const state of snapshot.states) {
    if (!state.entity_id.startsWith('scene.')) continue;
    const entry = snapshot.entities.find((entity) => entity.entity_id === state.entity_id);
    if (
      entry?.platform !== 'hue' ||
      (entry.config_entry_id && entry.config_entry_id !== configEntryId)
    )
      continue;
    const device = snapshot.devices.find((item) => item.id === entry.device_id);
    const groupIds = Array.isArray(device?.identifiers)
      ? device.identifiers.flatMap((identifier) =>
          Array.isArray(identifier) && identifier[0] === 'hue' ? [identifier[1]] : [],
        )
      : [];
    const groupName = state.attributes.group_name;
    const name = state.attributes.name ?? scenePresentation(state, groupName).title;
    const exact = scenes.filter((scene) => scene.id === entry.unique_id);
    const candidates = exact.length
      ? exact
      : scenes.filter((scene) => {
          if (normalized(record(scene.metadata).name) !== normalized(name)) return false;
          const groupId = record(scene.group).rid;
          return (
            groupIds.includes(groupId) ||
            (groupName && normalized(groups.get(groupId)) === normalized(groupName))
          );
        });
    // Redacted resource IDs can still be matched by the group and scene name.
    // A duplicate name without a unique group match is deliberately left unresolved.
    if (candidates.length !== 1) continue;
    const scene = candidates[0];
    const actions = records(scene.actions).map((entry) => record(entry.action));
    const litActions = actions.filter((action) => record(action.on).on !== false);
    const palette = record(scene.palette);
    const paletteColors = [...records(palette.color), ...records(palette.color_temperature)]
      .map(hueColor)
      .filter((color): color is string => Boolean(color));
    const colors = [
      ...new Set(
        paletteColors.length
          ? paletteColors
          : litActions.map(hueColor).filter((color): color is string => Boolean(color)),
      ),
    ].slice(0, 5);
    const dark = actions.length
      ? actions.every(
          (action) =>
            record(action.on).on === false ||
            (typeof record(action.dimming).brightness === 'number' &&
              record(action.dimming).brightness <= 4.7),
        )
      : undefined;
    if (colors.length || dark !== undefined) result[state.entity_id] = { colors, dark };
  }
  return result;
}

export async function loadHueSceneArtwork(
  snapshot: Snapshot,
  api: Pick<HausNative, 'request' | 'management'>,
): Promise<NonNullable<Snapshot['sceneArtwork']>> {
  if (
    !snapshot.user.is_admin ||
    !snapshot.entities.some(
      (entry) => entry.platform === 'hue' && entry.entity_id.startsWith('scene.'),
    )
  )
    return {};
  const entries = await api.request<
    Array<{ entry_id: string; domain: string; disabled_by?: string }>
  >({ type: 'config_entries/get' });
  const result: NonNullable<Snapshot['sceneArtwork']> = {};
  for (const entry of entries.filter((entry) => entry.domain === 'hue' && !entry.disabled_by)) {
    try {
      const diagnostics = await api.management({
        method: 'GET',
        path: `diagnostics/config_entry/${encodeURIComponent(entry.entry_id)}`,
      });
      Object.assign(result, hueSceneArtwork(snapshot, entry.entry_id, diagnostics));
    } catch {
      // The Home Assistant account may not have access to diagnostics.
    }
  }
  return result;
}
