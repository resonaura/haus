import type { HassEntity } from './types';

const brightnessModes = new Set([
  'brightness',
  'color_temp',
  'hs',
  'xy',
  'rgb',
  'rgbw',
  'rgbww',
  'white',
]);
const colorModes = new Set(['hs', 'xy', 'rgb', 'rgbw', 'rgbww']);

/** Use advertised color modes, never infer controls from a stale color/brightness attribute. */
export function lightProfile(entity: HassEntity) {
  const attrs = entity.attributes;
  const modes: string[] = Array.isArray(attrs.supported_color_modes)
    ? attrs.supported_color_modes.filter((mode): mode is string => typeof mode === 'string')
    : typeof attrs.color_mode === 'string'
      ? [attrs.color_mode]
      : [];
  const color = modes.some((mode) => colorModes.has(mode));
  const temperature = modes.includes('color_temp');
  const brightness = modes.some((mode) => brightnessModes.has(mode));
  return {
    color,
    temperature,
    brightness,
    kind: color ? 'color' : temperature ? 'temperature' : brightness ? 'dimmable' : 'onoff',
  } as const;
}

export function lightTemperature(entity: HassEntity): number | undefined {
  const attrs = entity.attributes;
  const kelvin = Number(
    attrs.color_temp_kelvin ?? (attrs.color_temp ? 1_000_000 / Number(attrs.color_temp) : 0),
  );
  return Number.isFinite(kelvin) && kelvin > 0 ? kelvin : undefined;
}

export function lightStateDescription(entity: HassEntity): string {
  if (entity.state !== 'on') return entity.state === 'off' ? 'Off' : entity.state;
  const profile = lightProfile(entity);
  const brightness = entity.attributes.brightness;
  const percent =
    profile.brightness && typeof brightness === 'number' && Number.isFinite(brightness)
      ? `${Math.round(Math.max(0, Math.min(255, brightness)) / 2.55)}% brightness`
      : 'On';
  const kelvin = lightTemperature(entity);
  return profile.temperature &&
    kelvin &&
    (!entity.attributes.color_mode || entity.attributes.color_mode === 'color_temp')
    ? `${percent} · ${Math.round(kelvin)} K`
    : percent;
}
