import type { HassEntity } from './types';
export type SceneTarget = Record<string, any>;
export function targetConfig(value: unknown): SceneTarget {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as SceneTarget)
    : { state: value };
}
const colors = [
  'color_temp',
  'color_temp_kelvin',
  'rgb_color',
  'hs_color',
  'xy_color',
  'rgbw_color',
  'rgbww_color',
];
const colorModes: Record<string, string> = {
  color_temp_kelvin: 'color_temp',
  color_temp: 'color_temp',
  hs_color: 'hs',
  xy_color: 'xy',
  rgb_color: 'rgb',
  rgbw_color: 'rgbw',
  rgbww_color: 'rgbww',
};
// Follow HA's scene reproduction order for older targets without color_mode.
const colorOrder = [
  'hs_color',
  'color_temp_kelvin',
  'rgb_color',
  'rgbw_color',
  'rgbww_color',
  'xy_color',
  'color_temp',
];
function targetColor(value: SceneTarget) {
  const supplied = colorOrder.filter((key) => value[key] != null);
  if (['onoff', 'brightness', 'white'].includes(value.color_mode)) return undefined;
  return supplied.find((key) => colorModes[key] === value.color_mode) ?? supplied[0];
}
export function patchSceneTarget(value: unknown, key: string, setting: unknown): SceneTarget {
  const next = { ...targetConfig(value) };
  if (colors.includes(key)) {
    for (const field of colors) delete next[field];
    next.color_mode = colorModes[key];
  }
  return { ...next, [key]: setting };
}
export function captureSceneTarget(entity: HassEntity): SceneTarget {
  const attrs = Object.fromEntries(
    Object.entries(entity.attributes).filter(([key]) =>
      [
        'brightness',
        ...colors,
        'current_position',
        'temperature',
        'percentage',
        'volume_level',
        'preset_mode',
        'effect',
      ].includes(key),
    ),
  );
  if (entity.entity_id.startsWith('light.')) {
    const color = targetColor(entity.attributes);
    for (const field of colors) if (field !== color) delete attrs[field];
    if (color === 'color_temp') {
      attrs.color_temp_kelvin = Math.round(1e6 / Number(attrs.color_temp));
      delete attrs.color_temp;
    }
    const mode = color ? colorModes[color] : entity.attributes.color_mode;
    if (mode === 'onoff') delete attrs.brightness;
    if (mode && (color || ['onoff', 'brightness', 'white'].includes(mode))) attrs.color_mode = mode;
  }
  return {
    state: ['unknown', 'unavailable'].includes(entity.state) ? 'off' : entity.state,
    ...attrs,
  };
}

/** Preview the draft, never a competing colour inherited from the live device. */
export function sceneTargetEntity(entity: HassEntity, value: unknown): HassEntity {
  const setting = targetConfig(value);
  const { state, ...settings } = setting;
  const attributes = { ...entity.attributes, ...settings };
  const color = targetColor(setting);
  if (color || setting.color_mode) {
    for (const field of colors) if (field !== color) delete attributes[field];
    attributes.color_mode = color ? colorModes[color] : setting.color_mode;
  }
  return { ...entity, state: String(state ?? entity.state), attributes };
}
export function sceneTargetSummary(id: string, setting: unknown) {
  const value = targetConfig(setting);
  if (value.state === 'off') return 'Off';
  const parts = [String(value.state ?? 'On').replaceAll('_', ' ')];
  if (id.startsWith('light.') && typeof value.brightness === 'number')
    parts.push(`${Math.round(value.brightness / 2.55)}%`);
  const kelvin = value.color_temp_kelvin ?? (value.color_temp ? 1e6 / Number(value.color_temp) : 0);
  if (Number.isFinite(kelvin) && kelvin > 0) parts.push(`${Math.round(kelvin)} K`);
  if (typeof value.temperature === 'number') parts.push(`${value.temperature}°`);
  if (typeof value.current_position === 'number') parts.push(`${value.current_position}% open`);
  return parts.join(' · ');
}
