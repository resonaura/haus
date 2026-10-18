import { useEffect, useState } from 'react';
import { pendingFeedbackDelay } from '../model/pending-feedback';

/** Keep quick commands quiet; measure from the shared command time across views. */
export function useDelayedPending(pending: boolean, since?: number): boolean {
  const key = since ?? 'local';
  const [visibleFor, setVisibleFor] = useState<number | 'local'>();
  useEffect(() => {
    setVisibleFor(undefined);
    if (!pending) return;
    const timer = setTimeout(() => setVisibleFor(key), pendingFeedbackDelay(since));
    return () => clearTimeout(timer);
  }, [pending, since, key]);
  return pending && visibleFor === key;
}
