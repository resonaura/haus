import type { HassEntity } from './types';
import { lightTemperature } from './light-profile';

/** Reported light output; contextual device accents are resolved separately. */
export function lightColor(entity: HassEntity): string | undefined {
  if (!entity.entity_id.startsWith('light.')) return undefined;
  const attrs = entity.attributes;
  const mode = attrs.color_mode;
  const modes = attrs.supported_color_modes;
  if (
    ['onoff', 'brightness', 'white'].includes(mode) ||
    (Array.isArray(modes) &&
      modes.length > 0 &&
      modes.every((value) => ['onoff', 'brightness', 'white'].includes(value)))
  )
    return undefined;
  const rgb = (channels: number[]) =>
    channels.every(Number.isFinite)
      ? `rgb(${channels.map((c) => Math.round(Math.max(0, Math.min(255, c)))).join(', ')})`
      : undefined;
  const kelvin = lightTemperature(entity);
  if ((!mode || mode === 'color_temp') && kelvin) {
    const t = kelvin / 100;
    return rgb(
      t <= 66
        ? [
            255,
            99.4708025861 * Math.log(t) - 161.1195681661,
            t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307,
          ]
        : [
            329.698727446 * (t - 60) ** -0.1332047592,
            288.1221695283 * (t - 60) ** -0.0755148492,
            255,
          ],
    );
  }
  if (mode === 'color_temp') return undefined;
  if ((!mode || mode === 'rgb') && Array.isArray(attrs.rgb_color) && attrs.rgb_color.length >= 3)
    return rgb(attrs.rgb_color.slice(0, 3).map(Number));
  if ((!mode || mode === 'hs') && Array.isArray(attrs.hs_color) && attrs.hs_color.length >= 2) {
    const [h, s] = attrs.hs_color.map(Number);
    if (Number.isFinite(h) && Number.isFinite(s)) {
      // HA's HS tuple describes HSV at full value, not HSL at 50% lightness.
      // HSL makes white and pastel scene targets gray after redundant RGB is removed.
      const hue = (((h % 360) + 360) % 360) / 60;
      const saturation = Math.max(0, Math.min(100, s)) / 100;
      const channel = (n: number) => {
        const k = (n + hue) % 6;
        return 255 * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1)));
      };
      return rgb([channel(5), channel(3), channel(1)]);
    }
  }
  if ((!mode || mode === 'xy') && Array.isArray(attrs.xy_color) && attrs.xy_color.length >= 2) {
    const [x, y] = attrs.xy_color.map(Number);
    if (y > 0 && Number.isFinite(x)) {
      const z = (1 - x - y) / y;
      const channels = [
        (3.2406 * x) / y - 1.5372 - 0.4986 * z,
        (-0.9689 * x) / y + 1.8758 + 0.0415 * z,
        (0.0557 * x) / y - 0.204 + 1.057 * z,
      ].map((c) => Math.max(0, c));
      const max = Math.max(1, ...channels);
      return rgb(
        channels.map((c) => {
          const v = c / max;
          return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
        }),
      );
    }
  }
  if (['rgbw', 'rgbww'].includes(mode)) {
    const channels = attrs[`${mode}_color`];
    if (Array.isArray(channels) && channels.length === (mode === 'rgbw' ? 4 : 5)) {
      const white = Math.max(...channels.slice(3).map(Number));
      return rgb(channels.slice(0, 3).map((channel: unknown) => Number(channel) + white));
    }
  }
  return undefined;
}
