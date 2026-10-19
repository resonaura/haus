import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { PreferenceSync, type SharedDocument } from '../ha/preference-sync';
import { sharedPreferences } from '../model/shared-preferences';
import { sanitizePreferences, defaults, type Preferences } from '../model/preferences';
export function usePreferenceSync(
  scope: string | undefined,
  activeHome: boolean,
  connected: boolean,
  preferences: Preferences,
  setPreferences: Dispatch<SetStateAction<Preferences>>,
) {
  const [state, setState] = useState<'local' | 'syncing' | 'synced' | 'offline'>('local');
  const latest = useRef(preferences);
  latest.current = preferences;
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    encodedRef = useRef('');
  const controller = useRef<PreferenceSync | null>(null),
    activeScope = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeHome || !scope || !window.hausNative) {
      activeScope.current = undefined;
      setState('local');
      return;
    }
    const api = window.hausNative,
      cacheKey = `haus.layout:${scope}`,
      baselineKey = `haus.layout-baseline:${scope}`;
    const apply = (patch: Record<string, unknown>) => {
      const next = sanitizePreferences({ ...latest.current, ...patch });
      if (
        JSON.stringify(sharedPreferences(next)) ===
        JSON.stringify(sharedPreferences(latest.current))
      )
        return;
      latest.current = next;
      setPreferences(next);
      localStorage.setItem('haus.preferences', JSON.stringify(next));
      localStorage.setItem(cacheKey, JSON.stringify(sharedPreferences(next)));
      void api.setPreferences(next).catch(() => {});
    };
    if (activeScope.current !== scope) {
      const cached = localStorage.getItem(cacheKey),
        previous = localStorage.getItem('haus.layout-scope');
      try {
        if (cached) apply(JSON.parse(cached));
        else if (previous && previous !== scope) apply(sharedPreferences(defaults));
      } catch {
        /* A damaged cache is replaced by the helper document. */
      }
      activeScope.current = scope;
      localStorage.setItem('haus.layout-scope', scope);
    }
    if (!connected) {
      setState('offline');
      return;
    }
    let baseline: Record<string, unknown> | undefined;
    try {
      const raw = localStorage.getItem(baselineKey);
      if (raw) baseline = JSON.parse(raw);
    } catch {
      /* Keep the current home cache. */
    }
    const sync = new PreferenceSync(
      {
        local: () => sharedPreferences(latest.current),
        apply,
        baseline: (value) => localStorage.setItem(baselineKey, JSON.stringify(value)),
        read: () => api.helper<SharedDocument>({ method: 'GET', path: '/api/preferences' }),
        write: (baseRevision, patch) =>
          api.helper<SharedDocument>({
            method: 'PATCH',
            path: '/api/preferences',
            data: { baseRevision, patch },
          }),
        status: setState,
      },
      baseline,
    );
    controller.current = sync;
    void sync.sync();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void sync.sync();
    }, 15000);
    return () => {
      sync.stop();
      clearTimeout(flushTimer.current);
      clearInterval(timer);
      controller.current = null;
    };
  }, [scope, activeHome, connected, setPreferences]);
  useEffect(() => {
    const encoded = JSON.stringify(sharedPreferences(latest.current)),
      key = `${activeHome ? scope : 'local'}:${encoded}`;
    if (encodedRef.current === key) return;
    encodedRef.current = key;
    if (activeHome && scope && activeScope.current === scope)
      localStorage.setItem(`haus.layout:${scope}`, encoded);
    controller.current?.changed();
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      if (document.visibilityState === 'visible') void controller.current?.sync();
    }, 700);
  }, [preferences, scope, activeHome]);
  useEffect(() => () => clearTimeout(flushTimer.current), []);
  return state;
}
