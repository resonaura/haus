/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readPreferences, usePreferenceSync } from './usePreferenceSync';
import { useAppearance, useDocumentAppearance } from './useAppearance';
import { defaults, sanitizePreferences, type Preferences } from '../model/preferences';
export type { Preferences, ManualUsage } from '../model/preferences';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { normalizeHome, type Snapshot, type HassEntity, type buildAction } from '../model';
import type { HomeTransportRequest } from '@haus/core/transport';
import type { NativeEvent, NativeSession } from '../../../shared/native';
import { getHomeTransport } from '../app/transport';
import { EntityActionQueue, OptimisticState } from '../model/optimistic';
import { sanitizeHomeLightMemories } from '../model/light-memory';
import { RegistryController } from '../ha/registry';
import { cameraSettings } from '../ha/camera-settings';
import { useAppNotifications } from './useAppNotifications';
import { createEmptySnapshot } from '../model/empty-home';
import { connectionView, mergeSourceHealth } from '../model/connection-view';
import { useConnectionHealth } from './connection';
import { executeQueuedHomeAction, shouldReloadHomeForLiveEvent } from './action-coalesce';
import { cachedHomeSnapshot } from '../model/cached-home';
import {
  formatHomeStartupError,
  hydrateLiveExtras,
  readLocalDemoMode,
  registerDemoModeSetter,
  writeLocalDemoMode,
} from './demo-override';

export type Action = ReturnType<typeof buildAction>;

export function useHaus() {
  const transport = getHomeTransport();
  const initialDemo = transport.mode === 'demo';
  const [serverSnapshot, setSnapshot] = useState<Snapshot>(() =>
    initialDemo ? transport.demo.getSnapshot() : createEmptySnapshot(),
  );
  const optimistic = useRef(new OptimisticState());
  const actionQueue = useRef(new EntityActionQueue());
  const actionGeneration = useRef(0);
  const [optimisticRevision, setOptimisticRevision] = useState(0);
  const invalidateOptimistic = useCallback(() => setOptimisticRevision((value) => value + 1), []);
  const snapshot = useMemo(
    () => optimistic.current.project(serverSnapshot),
    [serverSnapshot, optimisticRevision],
  );
  const serverSnapshotRef = useRef(serverSnapshot);
  serverSnapshotRef.current = serverSnapshot;
  const [mode, setMode] = useState<'demo' | 'live'>(() => (initialDemo ? 'demo' : 'live'));
  const [status, setStatus] = useState(() => (initialDemo ? 'demo' : 'restoring'));
  const [homeState, setHomeState] = useState<'loading' | 'ready' | 'error'>(() =>
    initialDemo ? 'ready' : 'loading',
  );
  const [homeError, setHomeError] = useState('');
  const [session, setSession] = useState<NativeSession | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const {
    health: sourceHealth,
    now: connectionNow,
    update: updateSourceHealth,
  } = useConnectionHealth(mode, status);
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const appearance = useAppearance(preferences.theme);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const preferenceSync = usePreferenceSync(
    session?.url,
    preferencesReady && mode === 'live',
    status === 'connected',
    preferences,
    setPreferences,
  );
  const notifications = useAppNotifications();
  const setNotice = notifications.notify;
  const reportOptimisticFailures = useCallback(() => {
    for (const failure of optimistic.current.takeFailures()) setNotice(failure, 'danger');
  }, [setNotice]);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const inDemo = useCallback(
    () => transport.mode === 'demo' || modeRef.current === 'demo',
    [transport],
  );
  const statusRef = useRef(status);
  statusRef.current = status;
  const registry = useRef<RegistryController | null>(null);
  if (!registry.current)
    registry.current = new RegistryController({
      snapshot: () => serverSnapshotRef.current,
      context: () => ({
        mode: modeRef.current,
        status: statusRef.current,
        generation: actionGeneration.current,
      }),
      commit: (update) => {
        const next = update(serverSnapshotRef.current);
        serverSnapshotRef.current = next;
        setSnapshot(next);
      },
      request: (input) => transport.request(input as HomeTransportRequest),
    });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const loadRevision = useRef(0);
  const connectionIntent = useRef(0);
  const loadedHome = useRef('');
  const notifyRef = useRef(setNotice);
  notifyRef.current = setNotice;
  const persistPreferences = useCallback((updater: (prev: Preferences) => Preferences) => {
    setPreferences((prev) => {
      const next = updater(prev);
      localStorage.setItem('haus.preferences', JSON.stringify(next));
      void window.hausNative
        ?.setPreferences(next)
        .catch((error) => notifyRef.current(message(error), 'danger'));
      return next;
    });
  }, []);
  const recordManualUse = useCallback(
    (entityId: string) => {
      persistPreferences((prev) => {
        const current = prev.manualUsage[entityId] ?? { count: 0, lastUsed: 0 };
        return {
          ...prev,
          manualUsage: {
            ...prev.manualUsage,
            [entityId]: { count: current.count + 1, lastUsed: Date.now() },
          },
        };
      });
    },
    [persistPreferences],
  );
  const load = useCallback(async () => {
    const api = window.hausNative;
    if (!api || inDemo()) return;
    const revision = ++loadRevision.current;
    setHomeState((current) => (current === 'ready' ? current : 'loading'));
    setHomeError('');
    const optional = async <T>(type: string, fallback: T): Promise<T> => {
      try {
        return await transport.request<T>({ type });
      } catch {
        return fallback;
      }
    };
    try {
      const [states, services, config, user, areas, devices, entities, currentSession] =
        await Promise.all([
          transport.request<Snapshot['states']>({ type: 'get_states' }),
          transport.request<Snapshot['services']>({ type: 'get_services' }),
          transport.request<Snapshot['config']>({ type: 'get_config' }),
          transport.request<Snapshot['user']>({ type: 'auth/current_user' }),
          optional<Snapshot['areas']>('config/area_registry/list', []),
          optional<Snapshot['devices']>('config/device_registry/list', []),
          optional<Snapshot['entities']>('config/entity_registry/list', []),
          api.getSession(),
        ]);
      if (revision !== loadRevision.current || inDemo()) return;
      const homeKey = `${currentSession?.url ?? ''}:${user.id ?? ''}`;
      cameraSettings.setScope(homeKey);
      void cameraSettings.refresh().catch(() => {});
      const previous = serverSnapshotRef.current;
      const sceneIds = new Set(
        states
          .filter((state) => state.entity_id.startsWith('scene.'))
          .map((state) => state.entity_id),
      );
      const loaded: Snapshot = {
        states,
        services,
        config,
        user,
        areas,
        devices,
        entities,
        ...(loadedHome.current === homeKey
          ? {
              sceneConfigs: Object.fromEntries(
                Object.entries(previous.sceneConfigs ?? {}).filter(([id]) => sceneIds.has(id)),
              ),
              sceneArtwork: Object.fromEntries(
                Object.entries(previous.sceneArtwork ?? {}).filter(([id]) => sceneIds.has(id)),
              ),
            }
          : {}),
      };
      loadedHome.current = homeKey;
      if (currentSession)
        optimistic.current.lightMemory.hydrate(
          currentSession.url,
          preferencesRef.current.lightMemories?.[currentSession.url],
        );
      serverSnapshotRef.current = loaded;
      for (const state of states) optimistic.current.reconcile(state);
      reportOptimisticFailures();
      setSnapshot(loaded);
      invalidateOptimistic();
      setMode('live');
      setHomeState('ready');
      setHomeError('');
      setStatus('connected');
      setSession(currentSession);
      hydrateLiveExtras({
        api,
        loaded,
        optimistic: optimistic.current,
        isActive: () => revision === loadRevision.current && modeRef.current === 'live',
        getServerStates: () => serverSnapshotRef.current.states,
        onLightRemembered: invalidateOptimistic,
        onSnapshotPatch: (patch) => setSnapshot((prev) => ({ ...prev, ...patch })),
      });
    } catch (error) {
      if (revision !== loadRevision.current || inDemo()) return;
      if (!loadedHome.current) {
        setHomeState('error');
        setHomeError(formatHomeStartupError(error));
      } else setNotice(message(error), 'danger');
    }
  }, [inDemo, invalidateOptimistic, reportOptimisticFailures, transport]);

  useEffect(() => {
    const api = window.hausNative;
    if (!api) return;
    let alive = true;
    const bootIntent = connectionIntent.current;
    const off = api.onEvent((event: NativeEvent) => {
      if (!alive) return;
      if (event.type === 'helper-live') {
        if (event.scope !== sessionRef.current?.url) return;
        updateSourceHealth(event);
        if (modeRef.current === 'live' && event.scope === sessionRef.current?.url && event.online) {
          if (event.topic === 'cameras') void cameraSettings.refresh(true).catch(() => {});
          else if (shouldReloadHomeForLiveEvent(event, sessionRef.current)) void load();
        }
        return;
      }
      if (event.type === 'connection') {
        if (modeRef.current === 'demo') return;
        if (event.status !== 'connected') {
          optimistic.current.clear();
          ++actionGeneration.current;
          invalidateOptimistic();
        }
        setStatus(event.status);
        if (event.error) {
          if (loadedHome.current) setNotice(event.error, 'danger');
          else {
            setHomeState('error');
            setHomeError(formatHomeStartupError(event.error));
          }
        }
        if (event.status === 'connected') void load();
      } else if (
        event.type === 'ha-event' &&
        event.event.event_type === 'state_changed' &&
        modeRef.current === 'live'
      ) {
        const state = event.event.data.new_state as HassEntity | null;
        const id = event.event.data.entity_id;
        const previousState = event.event.data.old_state as HassEntity | null;
        if (state && !optimistic.current.reconcile(state, event.event.context?.id)) return;
        reportOptimisticFailures();
        const userId = snapshotRef.current.user.id;
        if (
          state &&
          previousState &&
          typeof userId === 'string' &&
          !state.entity_id.startsWith('scene.') &&
          event.event.context?.user_id === userId
        )
          recordManualUse(state.entity_id);
        const prev = serverSnapshotRef.current;
        const next = {
          ...prev,
          states: state
            ? prev.states.some((s) => s.entity_id === state.entity_id)
              ? prev.states.map((s) => (s.entity_id === state.entity_id ? state : s))
              : [...prev.states, state]
            : prev.states.filter((s) => s.entity_id !== id),
        };
        serverSnapshotRef.current = next;
        setSnapshot(next);
        invalidateOptimistic();
      } else if (
        event.type === 'ha-event' &&
        event.event.event_type.endsWith('_registry_updated') &&
        modeRef.current === 'live'
      ) {
        void load();
      }
    });
    const cachedHomePromise = api.getCachedHome().catch(() => null);
    void api
      .getSession()
      .then(async (existing) => {
        if (!alive || bootIntent !== connectionIntent.current) return;
        if (existing) {
          setSession(existing);
          sessionRef.current = existing;
          if (inDemo() || readLocalDemoMode()) return;
          const cached = await cachedHomePromise;
          if (!alive || bootIntent !== connectionIntent.current || inDemo()) return;
          if (!loadedHome.current) {
            const snapshot = cachedHomeSnapshot(cached?.snapshot);
            if (snapshot) {
              loadedHome.current = `${existing.url}:${snapshot.user.id ?? ''}`;
              cameraSettings.setScope(loadedHome.current);
              serverSnapshotRef.current = snapshot;
              setSnapshot(snapshot);
              setMode('live');
              setStatus((status) => (status === 'connected' ? status : 'reconnecting'));
              setHomeState('ready');
              setHomeError('');
            }
          }
          void load();
        } else if (!loadedHome.current) {
          transport.setMode('demo', { persist: false });
          const demoSnap = transport.demo.getSnapshot();
          serverSnapshotRef.current = demoSnap;
          modeRef.current = 'demo';
          statusRef.current = 'demo';
          setSnapshot(demoSnap);
          setMode('demo');
          setStatus('demo');
          setHomeState('ready');
        }
      })
      .catch((error) => {
        if (
          alive &&
          bootIntent === connectionIntent.current &&
          !loadedHome.current &&
          modeRef.current !== 'demo'
        ) {
          setHomeState('error');
          setHomeError(formatHomeStartupError(error));
        }
      });
    void api
      .getPreferences()
      .then((p) => {
        if (alive && Object.keys(p).length)
          setPreferences(sanitizePreferences({ ...defaults, ...p }));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setPreferencesReady(true);
      });
    return () => {
      alive = false;
      off();
      ++loadRevision.current;
      ++actionGeneration.current;
      optimistic.current.clear();
    };
  }, [inDemo, load, recordManualUse, invalidateOptimistic, reportOptimisticFailures, transport]);

  useEffect(() => {
    if (!optimistic.current.size) return;
    const timer = setInterval(() => {
      const { expired, timedOut } = optimistic.current.expireTransactions();
      if (!expired) return;
      invalidateOptimistic();
      if (timedOut)
        setNotice(
          'Device confirmation is taking longer than expected. Showing the latest reported state.',
        );
    }, 500);
    return () => clearInterval(timer);
  }, [optimisticRevision, invalidateOptimistic]);

  const lightMemoryVersion = optimistic.current.lightMemory.version;
  const persistedLightMemory = useRef<{ scope: string; version: number } | undefined>(undefined);
  useEffect(() => {
    const scope = session?.url;
    if (mode !== 'live' || !scope) return;
    const memory = optimistic.current.lightMemory;
    const before = memory.version;
    memory.hydrate(scope, preferences.lightMemories?.[scope]);
    if (before !== memory.version) invalidateOptimistic();
    if (
      persistedLightMemory.current?.scope === scope &&
      persistedLightMemory.current.version === memory.version
    )
      return;
    const timer = setTimeout(() => {
      const lightMemories = sanitizeHomeLightMemories({
        ...preferencesRef.current.lightMemories,
        [scope]: memory.export(),
      });
      persistedLightMemory.current = { scope, version: memory.version };
      persistPreferences((prev) => ({ ...prev, lightMemories }));
    }, 650);
    return () => clearTimeout(timer);
  }, [
    lightMemoryVersion,
    preferences.lightMemories,
    session?.url,
    mode,
    invalidateOptimistic,
    persistPreferences,
  ]);

  useDocumentAppearance(appearance, preferences);

  const savePreferences = useCallback(
    (patch: Partial<Preferences>) => persistPreferences((prev) => ({ ...prev, ...patch })),
    [persistPreferences],
  );
  const favorite = useCallback(
    (id: string) =>
      persistPreferences((prev) => ({
        ...prev,
        favorites: prev.favorites.includes(id)
          ? prev.favorites.filter((i) => i !== id)
          : [...prev.favorites, id],
      })),
    [persistPreferences],
  );
  const act = useCallback(
    async (action: Action) => {
      if (mode === 'demo') {
        await transport.request({ type: 'call_service', ...action });
        const next = transport.demo.getSnapshot();
        next.states.forEach((item) => optimistic.current.lightMemory.remember(item));
        setSnapshot((serverSnapshotRef.current = next));
        return invalidateOptimistic();
      }
      if (status !== 'connected' || !window.hausNative)
        throw new Error('Your home is offline. Wait for reconnection before making changes.');
      await executeQueuedHomeAction({
        action,
        queue: actionQueue.current,
        optimistic: optimistic.current,
        getSnapshot: () => serverSnapshotRef.current,
        getGeneration: () => actionGeneration.current,
        invalidate: invalidateOptimistic,
        reportFailures: reportOptimisticFailures,
        send: (active) =>
          transport.request<{ context?: { id?: string } }>({ type: 'call_service', ...active }),
      });
    },
    [mode, status, transport, invalidateOptimistic, reportOptimisticFailures],
  );
  const setDemoMode = useCallback(
    (enabled: boolean) => {
      transport.setMode(enabled ? 'demo' : 'live');
      ++loadRevision.current;
      ++actionGeneration.current;
      optimistic.current.clear();
      invalidateOptimistic();
      if (enabled) {
        const demoSnap = transport.demo.getSnapshot();
        modeRef.current = 'demo';
        statusRef.current = 'demo';
        serverSnapshotRef.current = demoSnap;
        setSnapshot(demoSnap);
        setMode('demo');
        setStatus('demo');
        setHomeState('ready');
        setHomeError('');
        return;
      }
      const api = window.hausNative;
      const saved = sessionRef.current;
      if (!api || !saved) return;
      modeRef.current = 'live';
      setMode('live');
      setStatus('reconnecting');
      setHomeError('');
      loadedHome.current = '';
      void api
        .getCachedHome()
        .catch(() => null)
        .then((cached) => {
          if (modeRef.current !== 'live') return;
          const snap = cachedHomeSnapshot(cached?.snapshot);
          if (snap) {
            loadedHome.current = `${saved.url}:${snap.user.id ?? ''}`;
            cameraSettings.setScope(loadedHome.current);
            serverSnapshotRef.current = snap;
            setSnapshot(snap);
            setHomeState('ready');
          } else setHomeState('loading');
          void load();
        });
    },
    [invalidateOptimistic, load, transport],
  );
  useEffect(() => registerDemoModeSetter(setDemoMode), [setDemoMode]);
  const connect = async (url: string, pairingCode?: string, explicitHa = false) => {
    notifications.clear();
    if (!window.hausNative)
      throw new Error(
        'Open the Haus desktop app to connect to your Haus Hub. This browser preview runs the demo home.',
      );
    transport.setMode('live');
    ++connectionIntent.current;
    modeRef.current = 'live';
    setMode('live');
    setStatus('connecting');
    setHomeState('loading');
    setHomeError('');
    loadedHome.current = '';
    ++loadRevision.current;
    setSnapshot(createEmptySnapshot());
    ++actionGeneration.current;
    optimistic.current.clear();
    invalidateOptimistic();
    try {
      setSession(await window.hausNative.connect(url, pairingCode, explicitHa));
      await load();
    } catch (error) {
      setStatus('disconnected');
      setHomeState('error');
      setHomeError(formatHomeStartupError(error));
      throw error;
    }
  };
  const beginPairing = (url: string) =>
    window.hausNative ? window.hausNative.beginPairing(url) : Promise.resolve(false);
  const disconnect = async () => {
    writeLocalDemoMode(false);
    ++connectionIntent.current;
    ++loadRevision.current;
    notifications.clear();
    ++actionGeneration.current;
    optimistic.current.clear();
    cameraSettings.setScope('');
    invalidateOptimistic();
    await window.hausNative?.disconnect();
    ++loadRevision.current;
    loadedHome.current = '';
    transport.setMode('demo', { persist: false });
    const demoSnap = transport.demo.getSnapshot();
    serverSnapshotRef.current = demoSnap;
    modeRef.current = 'demo';
    setMode('demo');
    setHomeState('ready');
    setHomeError('');
    setStatus('demo');
    setSession(null);
    setSnapshot(demoSnap);
  };
  const updateEntity = (id: string, patch: { area_id?: string | null; name?: string }) =>
    registry.current!.updateEntity(id, patch);
  const cameraBindings = useSyncExternalStore(cameraSettings.subscribe, cameraSettings.getSnapshot);
  const viewSnapshot = useMemo(
    () =>
      connectionView(
        snapshot,
        mode !== 'live' || status === 'connected',
        sourceHealth.scope === session?.url
          ? mergeSourceHealth([sourceHealth.sources, sourceHealth.direct ?? []], connectionNow)
          : [],
        cameraBindings,
        connectionNow,
      ),
    [snapshot, mode, status, sourceHealth, session?.url, cameraBindings, connectionNow],
  );
  const model = useMemo(
    () => normalizeHome(viewSnapshot, cameraBindings),
    [viewSnapshot, cameraBindings],
  );
  return {
    snapshot: viewSnapshot,
    model,
    mode,
    status,
    homeState,
    homeError,
    session,
    preferences,
    appearance,
    preferenceSync,
    savePreferences,
    recordManualUse,
    favorite,
    act,
    connect,
    beginPairing,
    refresh: load,
    setDemoMode,
    disconnect,
    updateEntity,
    registry: registry.current,
    notifications,
    notify: setNotice,
  };
}
export const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type HausController = ReturnType<typeof useHaus>;
