import { usePreferenceSync } from './usePreferenceSync';
import { useAppearance } from './useAppearance';
import { defaults, sanitizePreferences, type Preferences } from '../model/preferences';
export type { Preferences, ManualUsage } from '../model/preferences';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  applyDemoAction,
  createDemoSnapshot,
  normalizeHome,
  type Snapshot,
  type HassEntity,
  type buildAction,
} from '../model';
import type { NativeEvent } from '../../../shared/native';
import { loadHueSceneArtwork } from '../ha/hue-scenes';
import { EntityActionQueue, OptimisticState } from '../model/optimistic';
import { sanitizeHomeLightMemories } from '../model/light-memory';
import { loadLastLightOutput } from '../ha/light-history';
import { RegistryController } from '../ha/registry';
import { cameraSettings } from '../ha/camera-settings';
import { useAppNotifications } from './useAppNotifications';
import { createEmptySnapshot } from '../model/empty-home';
import { connectionView, mergeSourceHealth, type SourceHealth } from '../model/connection-view';
import { cachedHomeSnapshot } from '../model/cached-home';

export type Action = ReturnType<typeof buildAction>;
const readPreferences = (): Preferences => {
  try {
    return sanitizePreferences(JSON.parse(localStorage.getItem('haus.preferences') ?? '{}'));
  } catch {
    return defaults;
  }
};

export function useHaus() {
  const [serverSnapshot, setSnapshot] = useState<Snapshot>(() =>
    window.hausNative ? createEmptySnapshot() : createDemoSnapshot(),
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
  const [mode, setMode] = useState<'demo' | 'live'>(() => (window.hausNative ? 'live' : 'demo'));
  const [status, setStatus] = useState(() => (window.hausNative ? 'restoring' : 'demo'));
  const [homeState, setHomeState] = useState<'loading' | 'ready' | 'error'>(() =>
    window.hausNative ? 'loading' : 'ready',
  );
  const [homeError, setHomeError] = useState('');
  const [session, setSession] = useState<{ url: string; name: string } | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [sourceHealth, setSourceHealth] = useState<{
    scope: string;
    online: boolean;
    sources: SourceHealth[];
    direct: SourceHealth[];
  }>({ scope: '', online: false, sources: [], direct: [] });
  const [connectionNow, setConnectionNow] = useState(Date.now);
  useEffect(() => {
    if (mode !== 'live' || status === 'connected') return;
    const timer = setInterval(() => setConnectionNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [mode, status]);
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
      request: (input) => {
        if (!window.hausNative) return Promise.reject(new Error('Connect your home first.'));
        return window.hausNative.request(input);
      },
    });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const loadRevision = useRef(0);
  const connectionIntent = useRef(0);
  const loadedHome = useRef('');
  const recordManualUse = useCallback((entityId: string) => {
    setPreferences((prev) => {
      const current = prev.manualUsage[entityId] ?? { count: 0, lastUsed: 0 };
      const next = {
        ...prev,
        manualUsage: {
          ...prev.manualUsage,
          [entityId]: { count: current.count + 1, lastUsed: Date.now() },
        },
      };
      localStorage.setItem('haus.preferences', JSON.stringify(next));
      if (window.hausNative)
        void window.hausNative
          .setPreferences(next)
          .catch((error) => setNotice(message(error), 'danger'));
      return next;
    });
  }, []);
  const load = useCallback(async () => {
    const api = window.hausNative;
    if (!api) return;
    const revision = ++loadRevision.current;
    setHomeState((current) => (current === 'ready' ? current : 'loading'));
    setHomeError('');
    const optional = async <T>(type: string, fallback: T): Promise<T> => {
      try {
        return await api.request<T>({ type });
      } catch {
        return fallback;
      }
    };
    try {
      const [states, services, config, user, areas, devices, entities, currentSession] =
        await Promise.all([
          api.request<Snapshot['states']>({ type: 'get_states' }),
          api.request<Snapshot['services']>({ type: 'get_services' }),
          api.request<Snapshot['config']>({ type: 'get_config' }),
          api.request<Snapshot['user']>({ type: 'auth/current_user' }),
          optional<Snapshot['areas']>('config/area_registry/list', []),
          optional<Snapshot['devices']>('config/device_registry/list', []),
          optional<Snapshot['entities']>('config/entity_registry/list', []),
          api.getSession(),
        ]);
      if (revision !== loadRevision.current) return;
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
      const missingOutput = states
        .filter((state) => optimistic.current.lightMemory.needsHistory(state))
        .map((state) => state.entity_id);
      void loadLastLightOutput(
        api,
        missingOutput,
        (id) => {
          const state = serverSnapshotRef.current.states.find((item) => item.entity_id === id);
          return (
            revision === loadRevision.current &&
            Boolean(state && optimistic.current.lightMemory.needsHistory(state))
          );
        },
        (state) => {
          if (revision !== loadRevision.current) return;
          optimistic.current.lightMemory.remember(state);
          invalidateOptimistic();
        },
      ).catch(() => {});
      void loadHueSceneArtwork(loaded, api)
        .then((sceneArtwork) => {
          if (revision === loadRevision.current) setSnapshot((prev) => ({ ...prev, sceneArtwork }));
        })
        .catch(() => {});
      const sceneEntities = states.filter(
        (entity) =>
          entity.entity_id.startsWith('scene.') &&
          typeof entity.attributes.id === 'string' &&
          /^[a-z0-9_-]{1,128}$/i.test(entity.attributes.id) &&
          entities.some(
            (entry) => entry.entity_id === entity.entity_id && entry.platform === 'homeassistant',
          ),
      );
      if (sceneEntities.length) {
        const queue = [...sceneEntities];
        const sceneConfigs: NonNullable<Snapshot['sceneConfigs']> = {};
        const loadSceneConfigs = async () => {
          while (queue.length) {
            const scene = queue.shift()!;
            try {
              const sceneConfig = await api.getSceneConfig(
                scene.entity_id,
                String(scene.attributes.id),
              );
              if (sceneConfig) sceneConfigs[scene.entity_id] = sceneConfig;
            } catch {
              /* Scene settings are optional; unavailable configs do not block the home view. */
            }
          }
        };
        void Promise.all(
          Array.from({ length: Math.min(4, sceneEntities.length) }, loadSceneConfigs),
        ).then(() => {
          if (revision !== loadRevision.current) return;
          setSnapshot((prev) => ({ ...prev, sceneConfigs }));
        });
      }
    } catch (error) {
      if (revision !== loadRevision.current) return;
      if (!loadedHome.current) {
        setHomeState('error');
        setHomeError(homeStartupError(error));
      } else setNotice(message(error), 'danger');
    }
  }, [invalidateOptimistic, reportOptimisticFailures]);

  useEffect(() => {
    const api = window.hausNative;
    if (!api) return;
    let alive = true;
    const bootIntent = connectionIntent.current;
    const off = api.onEvent((event: NativeEvent) => {
      if (!alive) return;
      if (event.type === 'helper-live') {
        if (event.scope !== sessionRef.current?.url) return;
        setSourceHealth((previous) => {
          const current =
            previous.scope === event.scope
              ? previous
              : { scope: event.scope, online: false, sources: [], direct: [] };
          return event.origin === 'nvr'
            ? { ...current, direct: event.sources ?? current.direct ?? [] }
            : { ...current, online: event.online, sources: event.sources ?? current.sources };
        });
        setConnectionNow(Date.now());
        if (event.scope === sessionRef.current?.url && event.online && event.topic === 'cameras')
          void cameraSettings.refresh(true).catch(() => {});
        return;
      }
      if (event.type === 'connection') {
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
            setHomeError(homeStartupError(event.error));
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
    void api
      .getSession()
      .then(async (existing) => {
        if (!alive || bootIntent !== connectionIntent.current) return;
        if (existing) {
          setSession(existing);
          sessionRef.current = existing;
          void load();
          const cached = await api.getCachedHome().catch(() => null);
          if (!alive || bootIntent !== connectionIntent.current || loadedHome.current) return;
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
        } else if (!loadedHome.current) {
          // Demo is an intentional unconnected experience, never a placeholder
          // while a saved real home is still being restored or loading.
          setSnapshot(createDemoSnapshot());
          setMode('demo');
          setStatus('demo');
          setHomeState('ready');
        }
      })
      .catch((error) => {
        if (alive && bootIntent === connectionIntent.current && !loadedHome.current) {
          setHomeState('error');
          setHomeError(homeStartupError(error));
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
  }, [load, recordManualUse, invalidateOptimistic, reportOptimisticFailures]);

  useEffect(() => {
    if (!optimistic.current.size) return;
    const timer = setInterval(() => {
      if (optimistic.current.expire()) {
        invalidateOptimistic();
        setNotice(
          'Device confirmation is taking longer than expected. Showing the latest state reported by Home Assistant.',
        );
      }
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
      setPreferences((prev) => {
        const next = { ...prev, lightMemories };
        localStorage.setItem('haus.preferences', JSON.stringify(next));
        void window.hausNative
          ?.setPreferences(next)
          .catch((error) => setNotice(message(error), 'danger'));
        return next;
      });
    }, 650);
    return () => clearTimeout(timer);
  }, [lightMemoryVersion, preferences.lightMemories, session?.url, mode, invalidateOptimistic]);

  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
    document.documentElement.classList.toggle('dark', appearance === 'dark');
  }, [appearance]);

  const savePreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem('haus.preferences', JSON.stringify(next));
      if (window.hausNative)
        void window.hausNative
          .setPreferences(next)
          .catch((error) => setNotice(message(error), 'danger'));
      return next;
    });
  }, []);
  const favorite = useCallback((id: string) => {
    setPreferences((prev) => {
      const next = {
        ...prev,
        favorites: prev.favorites.includes(id)
          ? prev.favorites.filter((i) => i !== id)
          : [...prev.favorites, id],
      };
      localStorage.setItem('haus.preferences', JSON.stringify(next));
      if (window.hausNative)
        void window.hausNative
          .setPreferences(next)
          .catch((error) => setNotice(message(error), 'danger'));
      return next;
    });
  }, []);
  const act = useCallback(
    async (action: Action) => {
      if (mode === 'demo') {
        setSnapshot((prev) => applyDemoAction(prev, action));
        return;
      }
      if (status !== 'connected' || !window.hausNative)
        throw new Error('Your home is offline. Wait for reconnection before making changes.');
      const api = window.hausNative;
      const generation = actionGeneration.current;
      const transaction = optimistic.current.begin(serverSnapshotRef.current, action);
      invalidateOptimistic();
      try {
        const result = await actionQueue.current.run(
          action.domain === 'scene' ? 'scene:home' : action.target.entity_id,
          () => {
            if (generation !== actionGeneration.current)
              throw new Error('The home connection changed before this command could be sent.');
            return api.request<{ context?: { id?: string } }>({ type: 'call_service', ...action });
          },
        );
        if (generation === actionGeneration.current) {
          optimistic.current.acknowledge(
            transaction,
            result?.context?.id,
            serverSnapshotRef.current,
          );
          reportOptimisticFailures();
          invalidateOptimistic();
        }
      } catch (error) {
        if (generation === actionGeneration.current) {
          optimistic.current.reject(transaction);
          invalidateOptimistic();
        }
        throw error;
      }
    },
    [mode, status, invalidateOptimistic, reportOptimisticFailures],
  );
  const connect = async (url: string) => {
    notifications.clear();
    if (!window.hausNative)
      throw new Error(
        'Open the Haus desktop app to connect to Home Assistant. This browser preview runs the demo home.',
      );
    ++connectionIntent.current;
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
      setSession(await window.hausNative.connect(url));
      await load();
    } catch (error) {
      setStatus('disconnected');
      setHomeState('error');
      setHomeError(homeStartupError(error));
      throw error;
    }
  };
  const disconnect = async () => {
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
    setMode('demo');
    setHomeState('ready');
    setHomeError('');
    setStatus('demo');
    setSession(null);
    setSnapshot(createDemoSnapshot());
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
    refresh: load,
    disconnect,
    updateEntity,
    registry: registry.current,
    notifications,
    notify: setNotice,
  };
}
export const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function homeStartupError(error: unknown): string {
  if (/saved session could not be unlocked/i.test(message(error)))
    return 'Your saved Home Assistant sign-in needs to be restored. Manage the connection to sign in again.';
  return 'Check your connection and try again, or manage your Home Assistant connection.';
}

export type HausController = ReturnType<typeof useHaus>;
