import type { HausAccessory } from './types';

export function isKettle(accessory: Pick<HausAccessory, 'model' | 'state'>) {
  return /\bkettle\b/i.test(`${accessory.model ?? ''} ${accessory.state.attributes.icon ?? ''}`);
}

export function heaterModeLabel(mode: string, kettle: boolean) {
  if (kettle && mode === 'electric') return 'Heat';
  if (kettle && mode === 'performance') return 'Boil';
  return mode.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function kettleHasActiveTarget(mode: string) {
  return mode === 'electric' || mode === 'performance';
}

export function knownTemperature(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
