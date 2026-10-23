/** Format sensor readings without exposing floating-point storage noise. */
export function formatTemperature(
  value: unknown,
  suggestedPrecision?: unknown,
): string | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;

  const precision =
    typeof suggestedPrecision === 'number' &&
    Number.isInteger(suggestedPrecision) &&
    suggestedPrecision >= 0 &&
    suggestedPrecision <= 6
      ? suggestedPrecision
      : 1;
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: precision,
    useGrouping: false,
  }).format(numeric);
}
