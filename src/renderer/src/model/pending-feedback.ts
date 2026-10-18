export const DEVICE_FEEDBACK_DELAY_MS = 6000;

export function earliestPending(values: (number | undefined)[]): number | undefined {
  const times = values.filter((value): value is number => Number.isFinite(value));
  return times.length ? Math.min(...times) : undefined;
}

export function pendingFeedbackDelay(since?: number, now = Date.now()): number {
  return since === undefined
    ? DEVICE_FEEDBACK_DELAY_MS
    : Math.max(0, DEVICE_FEEDBACK_DELAY_MS - Math.max(0, now - since));
}
