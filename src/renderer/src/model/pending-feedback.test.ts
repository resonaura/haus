import { describe, expect, it } from 'vitest';
import { earliestPending, pendingFeedbackDelay } from './pending-feedback';

describe('quiet device confirmation feedback', () => {
  it('waits six seconds from the command, including when another view opens', () => {
    expect(pendingFeedbackDelay(1000, 1000)).toBe(6000);
    expect(pendingFeedbackDelay(1000, 6500)).toBe(500);
    expect(pendingFeedbackDelay(1000, 7000)).toBe(0);
    expect(pendingFeedbackDelay(1000, 9000)).toBe(0);
    expect(pendingFeedbackDelay(undefined, 9000)).toBe(6000);
  });

  it('uses the earliest pending group member and tolerates empty or invalid timestamps', () => {
    expect(earliestPending([undefined, 3000, 1000, NaN])).toBe(1000);
    expect(earliestPending([undefined])).toBeUndefined();
    expect(pendingFeedbackDelay(5000, 1000)).toBe(6000);
  });
});
