/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useCallback, useEffect, useState } from 'react';
import type { NativeEvent } from '../../../shared/native';
import type { SourceHealth } from '../model/connection-view';

/** Keeps provider observations independent from the HA connection's lifecycle. */
export function useConnectionHealth(mode: 'demo' | 'live', status: string) {
  const [health, setHealth] = useState<{
    scope: string;
    online: boolean;
    sources: SourceHealth[];
    direct: SourceHealth[];
  }>({ scope: '', online: false, sources: [], direct: [] });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (mode !== 'live' || status === 'connected') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [mode, status]);
  const update = useCallback((event: Extract<NativeEvent, { type: 'helper-live' }>) => {
    setHealth((previous) => {
      const current =
        previous.scope === event.scope
          ? previous
          : { scope: event.scope, online: false, sources: [], direct: [] };
      return event.origin === 'nvr'
        ? { ...current, direct: event.sources ?? current.direct ?? [] }
        : { ...current, online: event.online, sources: event.sources ?? current.sources };
    });
    setNow(Date.now());
  }, []);
  return { health, now, update };
}
