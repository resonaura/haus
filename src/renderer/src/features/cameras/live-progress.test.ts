import { describe, expect, it } from 'vitest';
import { LiveProgress } from './live-progress';

describe('live decoded-frame health', () => {
  it('repairs once before a bounded restart if media stops progressing', () => {
    const progress = new LiveProgress();
    progress.reset(100);
    progress.frame(20, 100);
    expect(progress.check(4099)).toBe('wait');
    expect(progress.check(4100)).toBe('repair');
    expect(progress.check(8000)).toBe('wait');
    expect(progress.check(10100)).toBe('restart');
  });
  it('ignores a repeating frame but accepts recovery and timestamp resets', () => {
    const progress = new LiveProgress();
    progress.reset(0);
    progress.frame(20, 0);
    progress.frame(20, 3000);
    expect(progress.check(4000)).toBe('repair');
    progress.frame(20.1, 4100);
    expect(progress.check(8000)).toBe('wait');
    progress.frame(0, 8100);
    expect(progress.check(12000)).toBe('wait');
  });
  it('does not reconnect hidden windows or a suspended computer in a tight loop', () => {
    const progress = new LiveProgress();
    progress.reset(0);
    expect(progress.check(300000, false)).toBe('wait');
    expect(progress.check(300100)).toBe('wait');
    expect(progress.check(310000)).toBe('restart');
    expect(progress.check(310001)).toBe('wait');
  });
});
