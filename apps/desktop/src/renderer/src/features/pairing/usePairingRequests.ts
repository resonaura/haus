/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useState } from 'react';
import type { PendingPairingRequest } from './types.js';

interface RawPairingResponse {
  requests?: PendingPairingRequest[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function usePairingRequests(connected: boolean, session?: { kind?: string } | null) {
  const [requests, setRequests] = useState<PendingPairingRequest[]>([]);
  const isHub = Boolean(connected && session?.kind === 'haus-hub');

  const poll = useCallback(async () => {
    if (!isHub || typeof window === 'undefined' || !window.hausNative) return;
    try {
      const result = await window.hausNative.management({
        method: 'GET',
        path: 'auth/pairing-requests',
      });
      if (isRecord(result) && Array.isArray((result as RawPairingResponse).requests)) {
        setRequests((result as RawPairingResponse).requests ?? []);
      }
    } catch {
      // Hub may not have active admin session or endpoint temporarily unavailable
    }
  }, [isHub]);

  useEffect(() => {
    if (!isHub) {
      setRequests([]);
      return;
    }

    void poll();
    const timer = setInterval(() => void poll(), 3500);

    const onFocus = () => void poll();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
    }

    const unsubscribe = window.hausNative?.onEvent?.((event) => {
      if (
        event.type === 'helper-live' &&
        (event.topic === 'pairing' || event.topic === 'preferences' || event.topic === 'home')
      ) {
        void poll();
      }
    });

    return () => {
      clearInterval(timer);
      unsubscribe?.();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
      }
    };
  }, [isHub, poll]);

  const dismiss = useCallback(async (sessionId: string) => {
    setRequests((prev) => prev.filter((r) => r.sessionId !== sessionId));
    if (typeof window === 'undefined' || !window.hausNative) return;
    try {
      await window.hausNative.management({
        method: 'POST',
        path: 'auth/pairing-requests/dismiss',
        data: { sessionId },
      });
    } catch {
      // If dismiss fails, next poll will refresh truthfully
    }
  }, []);

  return {
    requests,
    activePairing: requests[0] ?? null,
    dismissPairing: dismiss,
  };
}
