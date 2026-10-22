import { clamp } from './control-values';

export function snapTemperature(value: number, min: number, max: number, step: number) {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const snapped = min + Math.round((value - min) / safeStep) * safeStep;
  return Math.round(clamp(snapped, min, max) * 1000) / 1000;
}

export function temperatureFromDialPoint(
  x: number,
  y: number,
  min: number,
  max: number,
  step: number,
) {
  const rawAngle = (Math.atan2(y - 90, x - 90) * 180) / Math.PI;
  const angle = rawAngle < 135 ? rawAngle + 360 : rawAngle;
  const progress = clamp((angle - 135) / 270, 0, 1);
  return snapTemperature(min + progress * (max - min), min, max, step);
}
