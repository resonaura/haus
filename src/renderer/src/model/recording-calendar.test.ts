import { expect, it } from 'vitest';
import { recordingDay, recordingDayRange, recordingMonthBoundaries } from './recording-calendar';
it('builds local calendar boundaries without rounding across daylight-saving changes', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const spring = recordingMonthBoundaries('2026-03');
    const fall = recordingMonthBoundaries('2026-11');
    expect(spring).toHaveLength(32);
    expect(spring[8] - spring[7]).toBe(23 * 3600000);
    expect(fall[1] - fall[0]).toBe(25 * 3600000);
    expect(recordingDay(spring[8])).toBe('2026-03-09');
    expect(recordingDayRange('2026-03-08')).toEqual({ from: spring[7], to: spring[8] });
    expect(recordingMonthBoundaries('2028-02')).toHaveLength(30);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
