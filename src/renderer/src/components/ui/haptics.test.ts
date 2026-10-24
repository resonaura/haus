import { expect, it, vi } from 'vitest';
import { sliderHasDetents, triggerHaptic } from './haptics';

it('ticks deliberate slider steps but never treats dense or invalid ranges as detents', () => {
  expect(sliderHasDetents(0, 24, 1)).toBe(true);
  expect(sliderHasDetents(-48, 48, 1)).toBe(true);
  for (const values of [
    [0, 100, 1],
    [0, 1, 0.001],
    [0, 10, 0],
    [4, 4, 1],
    [0, Infinity, 1],
  ])
    expect(sliderHasDetents(...(values as [number, number, number]))).toBe(false);
});

it('keeps browser fallback silent and bounds shared UI sources without sending while hidden', () => {
  const emit = vi.fn();
  let at = 100;
  vi.stubGlobal('window', {});
  expect(() => triggerHaptic()).not.toThrow();
  vi.stubGlobal('window', { hausNative: { hapticFeedback: emit } });
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  triggerHaptic();
  expect(emit).not.toHaveBeenCalled();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.spyOn(performance, 'now').mockImplementation(() => at);
  triggerHaptic('generic');
  triggerHaptic('alignment');
  at += 35;
  triggerHaptic('alignment');
  expect(emit.mock.calls).toEqual([['generic'], ['alignment']]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
