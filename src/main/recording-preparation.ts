import { setTimeout as pause } from 'node:timers/promises';

/** Keep slow encoder work out of a single long-lived ingress response. */
export async function recordingPreparation(
  request: () => Promise<Response>,
  signal: AbortSignal,
  { pollMs = 1000, timeoutMs = 600000 } = {},
) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    const response = await request();
    if (response.status !== 202) return response;
    await response.body?.cancel();
    await pause(Math.min(pollMs, Math.max(0, deadline - performance.now())), undefined, { signal });
  }
  throw new Error('This recording is taking longer to prepare. Try again shortly.');
}
