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
export function patchSceneTarget(value: unknown, key: string, setting: unknown): SceneTarget {
  const next = { ...targetConfig(value) };
  if (colors.includes(key)) for (const field of colors) delete next[field];
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
      ].includes(key),
    ),
  );
  const mode = entity.attributes.color_mode;
  if (mode === 'color_temp')
    for (const field of colors.filter((key) => !key.startsWith('color_temp'))) delete attrs[field];
  else if (mode) {
    delete attrs.color_temp;
    delete attrs.color_temp_kelvin;
  }
  return {
    state: ['unknown', 'unavailable'].includes(entity.state) ? 'off' : entity.state,
    ...attrs,
  };
}
export function sceneTargetSummary(id: string, setting: unknown) {
  const value = targetConfig(setting);
  if (value.state === 'off') return 'Off';
  const parts = [String(value.state ?? 'On').replaceAll('_', ' ')];
  if (id.startsWith('light.') && typeof value.brightness === 'number')
    parts.push(`${Math.round(value.brightness / 2.55)}%`);
  if (value.color_temp_kelvin) parts.push(`${Math.round(value.color_temp_kelvin)} K`);
  if (typeof value.temperature === 'number') parts.push(`${value.temperature}°`);
  if (typeof value.current_position === 'number') parts.push(`${value.current_position}% open`);
  return parts.join(' · ');
}
