/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useEffect, useRef, useState } from 'react';
import { serverRequest } from '../servers/server-api';

export type NativeHandoverState =
  | 'connected'
  | 'ready'
  | 'import_required'
  | 'integration_required'
  | 'migration_required'
  | 'restoring'
  | 'unavailable';
export interface NativeHandover {
  bridgeId: string;
  provider: string;
  state: NativeHandoverState;
  cameras: {
    cameraId: string | null;
    name: string;
    imported: boolean;
    ready: boolean;
    connected: boolean;
    legacyEntities: string[];
  }[];
}

/** Only poll while this settings panel is visible; never replay a handover after failure. */
export function useNativeHandover(filter: { cameraId?: string; bridgeId?: string }) {
  const [bridges, setBridges] = useState<NativeHandover[]>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const polling = useRef<number | undefined>(undefined);
  const action = useRef(false);
  const { cameraId, bridgeId } = filter;
  const refreshRef = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    const current = ++generation.current;
    setBridges(undefined);
    setError('');
    setPending(false);
    const refresh = async () => {
      if (polling.current === current || document.visibilityState === 'hidden') return;
      polling.current = current;
      try {
        const result = await serverRequest<{ bridges: NativeHandover[] }>(
          'GET',
          '/api/providers/handover',
        );
        if (current !== generation.current) return;
        setBridges(
          result.bridges.filter((item) =>
            bridgeId
              ? item.bridgeId === bridgeId
              : item.cameras.some((camera) => camera.cameraId === cameraId),
          ),
        );
        setError('');
      } catch {
        if (current === generation.current)
          setError(
            'Home Assistant connection status is unavailable. Check Haus Helper and try again.',
          );
      } finally {
        if (polling.current === current) polling.current = undefined;
      }
    };
    refreshRef.current = refresh;
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      generation.current++;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [cameraId, bridgeId]);
  const complete = async (id: string) => {
    const bridge = bridges?.find((item) => item.bridgeId === id);
    if (action.current || error || bridge?.state !== 'ready') return;
    const current = generation.current;
    action.current = true;
    setPending(true);
    try {
      await serverRequest('POST', `/api/providers/${id}/handover`, {});
      if (current === generation.current) await refreshRef.current?.();
    } catch {
      if (current === generation.current) {
        await refreshRef.current?.();
        setError('Could not finish connecting. Check Home Assistant, then try again.');
      }
    } finally {
      action.current = false;
      if (current === generation.current) setPending(false);
    }
  };
  return { bridges, error, pending, complete };
}
