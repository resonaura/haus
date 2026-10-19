export const numeric = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
export const humanize = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
