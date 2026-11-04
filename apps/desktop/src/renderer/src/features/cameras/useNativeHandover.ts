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
  migration?: NativeMigration | null;
  cameras: {
    cameraId: string | null;
    name: string;
    imported: boolean;
    ready: boolean;
    connected: boolean;
    legacyEntities: string[];
  }[];
}
export interface NativeMigration {
  revision: string;
  phase:
    | 'review'
    | 'applying'
    | 'migrated'
    | 'undoing'
    | 'undone'
    | 'interrupted'
    | 'needs_attention'
    | 'commit_pending'
    | 'committed';
  replacements: { from: string; to: string }[];
  retirements: string[];
  blockers: string[];
  references: string[];
  error?: string;
  rollbackFailures: string[];
}

/** Only poll while this settings panel is visible; never replay a handover after failure. */
export function useNativeHandover(filter: { cameraId?: string; bridgeId?: string }) {
  const [bridges, setBridges] = useState<NativeHandover[]>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const polling = useRef<number | undefined>(undefined);
  const action = useRef(false);
  const responseEpoch = useRef(0);
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
      const epoch = responseEpoch.current;
      try {
        const result = await serverRequest<{ bridges: NativeHandover[] }>(
          'GET',
          '/api/providers/handover',
        );
        if (current !== generation.current || epoch !== responseEpoch.current) return;
        setBridges(
          result.bridges.filter((item) =>
            bridgeId
              ? item.bridgeId === bridgeId
              : item.cameras.some((camera) => camera.cameraId === cameraId),
          ),
        );
        setError('');
      } catch {
        if (current === generation.current && epoch === responseEpoch.current)
          setError(
            'Home Assistant connection status is unavailable. Check Haus Hub and try again.',
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
  const execute = async (
    id: string,
    operation: 'handover' | 'migration/review' | 'migration/apply' | 'migration/undo',
    data: Record<string, unknown>,
  ) => {
    const bridge = bridges?.find((item) => item.bridgeId === id);
    if (action.current || !bridge || (operation === 'handover' && bridge.state !== 'ready')) return;
    const current = generation.current;
    responseEpoch.current++;
    action.current = true;
    setPending(true);
    setError('');
    try {
      const result = await serverRequest<NativeMigration>(
        'POST',
        `/api/providers/${id}/${operation}`,
        data,
      );
      if (current === generation.current && operation.startsWith('migration/'))
        setBridges((items) =>
          items?.map((item) => (item.bridgeId === id ? { ...item, migration: result } : item)),
        );
      if (current === generation.current) await refreshRef.current?.();
    } catch {
      if (current === generation.current) {
        await refreshRef.current?.();
        setError(
          'Could not complete this step. Check Home Assistant and review the current transfer status before trying again.',
        );
      }
    } finally {
      action.current = false;
      if (current === generation.current) setPending(false);
    }
  };
  return {
    bridges,
    error,
    pending,
    complete: (id: string) => execute(id, 'handover', {}),
    migrate: (
      id: string,
      operation: 'review' | 'apply' | 'undo',
      data: Record<string, unknown> = {},
    ) => execute(id, `migration/${operation}`, data),
  };
}
