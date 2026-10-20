import { describe, expect, it } from 'vitest';
import { LiveHlsRecovery } from './live-hls-recovery';

describe('live decoder recovery', () => {
  const fragments = [10, 12, 14, 16, 18].map((start) => ({ start, duration: 2 }));

  it('skips the failed fragment even if its decoder clock is left behind', () => {
    const recovery = new LiveHlsRecovery();
    expect(recovery.next(0, 11.5, fragments)).toBe(12.001);
    expect(recovery.next(5000, 11.5, fragments)).toBe(14.001);
    expect(recovery.next(6000, 11.5, fragments)).toBeUndefined();
  });

  it('allows another bounded attempt after a stable minute', () => {
    const recovery = new LiveHlsRecovery();
    recovery.next(0, 11.5, fragments);
    recovery.next(5000, 12.5, fragments);
    expect(recovery.next(65000, 15, fragments)).toBe(16.001);
  });

  it('waits for a safe new segment rather than retrying corrupt or invalid data', () => {
    const recovery = new LiveHlsRecovery();
    expect(recovery.next(0, 18.5, fragments)).toBeUndefined();
    expect(recovery.next(1, NaN, fragments)).toBeUndefined();
    expect(recovery.next(2, 19, [{ start: 20, duration: NaN }])).toBeUndefined();
    expect(recovery.next(3, 19, [{ start: 20, duration: 2 }])).toBe(20.001);
  });
});
