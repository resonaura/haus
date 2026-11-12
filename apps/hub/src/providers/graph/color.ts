/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export function rgb(hue: number, saturation: number): { r: number; g: number; b: number } {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = saturation / 100,
    x = c * (1 - Math.abs((h % 2) - 1)),
    m = 1 - c;
  const channels =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  return {
    r: Math.round(((channels[0] ?? 0) + m) * 255),
    g: Math.round(((channels[1] ?? 0) + m) * 255),
    b: Math.round(((channels[2] ?? 0) + m) * 255),
  };
}

export function hueSaturation(input: unknown): { hue: number; saturation: number } {
  if (!input || typeof input !== 'object') throw Error('invalid_bridge_command');
  const channels: number[] = [];
  for (const channel of ['r', 'g', 'b']) {
    const value: unknown = Reflect.get(input, channel);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 255)
      throw Error('invalid_bridge_command');
    channels.push(value / 255);
  }
  const [r = 0, g = 0, b = 0] = channels,
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const raw = !delta
    ? 0
    : max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return { hue: (raw * 60 + 360) % 360, saturation: max ? (delta / max) * 100 : 0 };
}
