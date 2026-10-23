import { expect, it, vi } from 'vitest';
import { NativeHaptics } from './haptics';

it('does not load native services on unsupported platforms or invalid input', () => {
  const load = vi.fn(() => vi.fn(() => true));
  for (const platform of ['linux', 'win32'] as const)
    new NativeHaptics(platform, load).perform('alignment');
  const mac = new NativeHaptics('darwin', load);
  for (const pattern of [undefined, '', {}, 'strong', 1]) mac.perform(pattern);
  expect(load).not.toHaveBeenCalled();
});

it('coalesces duplicate sources and slider bursts on a monotonic clock', () => {
  let at = 100;
  const perform = vi.fn(() => true);
  const load = vi.fn(() => perform);
  const haptics = new NativeHaptics('darwin', load, () => at);
  haptics.perform('generic');
  haptics.perform('alignment');
  at += 34;
  haptics.perform('levelChange');
  at += 1;
  haptics.perform('alignment');
  at += 35;
  haptics.perform('levelChange');
  expect(perform.mock.calls).toEqual([['generic'], ['alignment'], ['levelChange']]);
  expect(load).toHaveBeenCalledOnce();
});

it('unavailable feedback fails silently without repeatedly loading a failed bridge', () => {
  const load = vi.fn(() => {
    throw new Error('unavailable');
  });
  const haptics = new NativeHaptics('darwin', load);
  expect(() => {
    haptics.perform('generic');
    haptics.perform('alignment');
  }).not.toThrow();
  expect(load).toHaveBeenCalledOnce();
});
