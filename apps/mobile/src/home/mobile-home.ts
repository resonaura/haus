/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Auth, openHaTransport } from '@haus/ha/ha-transport';
import { fetch as nativeFetch } from 'expo/fetch';
import { createHausHomeStore, type HausHomeStore } from '@haus/ha/store';
import type { AuthData, HaTransport } from '@haus/ha/ha-transport';
import { HaIngressHelperPort } from '@haus/ha/helper-ingress';
import { defaults, sanitizePreferences, type Preferences } from '@haus/ha/view/preferences';
import { mobilePersistence } from '../storage/native-persistence';
import type { HaSession } from '../storage/mobile-persistence';

import {
  decodeHaSnapshot as decodeMobileSnapshot,
  readHaSnapshot as readHomeSnapshot,
} from '@haus/ha/snapshot';
export { decodeMobileSnapshot };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function authData(session: HaSession): AuthData {
  return {
    hassUrl: session.url,
    clientId: session.clientId,
    expires: 0,
    refresh_token: session.refreshToken,
    access_token: '',
    expires_in: 0,
  };
}

export interface MobileHomeRuntime {
  store: HausHomeStore;
  session: HaSession;
  readonly preferences: Preferences;
  subscribePreferences(listener: () => void): () => void;
  setActive(active: boolean): void;
  reconnect(): Promise<void>;
  logout(): Promise<void>;
  dispose(): void;
}

export async function openMobileHome(
  initialSession: HaSession,
  onSessionChanged: (session: HaSession) => void,
): Promise<MobileHomeRuntime> {
  let session = initialSession;
  let auth: Auth;
  let transport: HaTransport | undefined;
  let alive = true;
  let cacheTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotFlight: Promise<void> | undefined;
  let preferencesFlight: Promise<void> | undefined;
  let preferencesTimer: ReturnType<typeof setInterval> | undefined;
  let foreground = true;
  const preferenceListeners = new Set<() => void>();

  const persistAuthData = (data: AuthData | null) => {
    if (!alive || !data?.refresh_token) return;
    session = {
      ...session,
      refreshToken: data.refresh_token,
    };
    void mobilePersistence
      .saveSession(session)
      .then(() => onSessionChanged(session))
      .catch(() => undefined);
  };

  auth = new Auth(authData(session), persistAuthData);

  const homeId = session.url;
  const [cached, cachedPreferences] = await Promise.all([
    mobilePersistence.loadHomeSnapshot(session, decodeMobileSnapshot),
    mobilePersistence.loadHomePreferences(session),
  ]);
  let preferences = cachedPreferences ?? defaults;
  const helper = new HaIngressHelperPort({
    homeUrl: session.url,
    requestHa: <T>(message: Parameters<HaTransport['request']>[0]) => {
      if (!alive || !transport?.connected) return Promise.reject(new Error('offline'));
      return transport.request<T>(message);
    },
    fetch: (input, init) => nativeFetch(String(input), init),
  });
  const store = createHausHomeStore({
    openTransport: async () => {
      const next = await openHaTransport(auth);
      transport = next;
      return next;
    },
  });
  if (cached) store.getState().hydrateSnapshot(homeId, cached.snapshot);

  const refreshPreferences = (): Promise<void> => {
    if (!alive || !foreground || !transport?.connected) return Promise.resolve();
    if (preferencesFlight) return preferencesFlight;
    const flight = helper
      .request<unknown>({ method: 'GET', path: '/api/preferences' })
      .then(async (document) => {
        if (
          !alive ||
          !isRecord(document) ||
          typeof document.revision !== 'string' ||
          !isRecord(document.value)
        )
          return;
        const next = sanitizePreferences(document.value);
        if (JSON.stringify(next) === JSON.stringify(preferences)) return;
        preferences = next;
        for (const listener of preferenceListeners) listener();
        await mobilePersistence.saveHomePreferences(session, next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (preferencesFlight === flight) preferencesFlight = undefined;
      });
    preferencesFlight = flight;
    return flight;
  };

  const setActive = (active: boolean) => {
    foreground = active;
    if (preferencesTimer) clearInterval(preferencesTimer);
    preferencesTimer = undefined;
    if (alive && foreground) {
      void refreshPreferences();
      preferencesTimer = setInterval(() => void refreshPreferences(), 15_000);
    }
  };

  const bootstrap = (): Promise<void> => {
    if (!alive || !transport?.connected) return Promise.resolve();
    if (snapshotFlight) return snapshotFlight;
    const currentTransport = transport;
    const flight = readHomeSnapshot(currentTransport)
      .then(async (snapshot) => {
        if (!alive || transport !== currentTransport || !currentTransport.connected) return;
        store.getState().hydrateLiveSnapshot(homeId, snapshot);
        const current = store.getState().confirmedSnapshot();
        if (current) await mobilePersistence.saveHomeSnapshot(session, current);
      })
      .catch(() => undefined)
      .finally(() => {
        if (snapshotFlight === flight) snapshotFlight = undefined;
      });
    snapshotFlight = flight;
    return flight;
  };

  const stopConnection = store.subscribe(
    (state) => state.connection,
    (connection) => {
      if (connection === 'connected') {
        void bootstrap();
        void refreshPreferences();
      }
    },
  );
  const stopSnapshot = store.subscribe(
    (state) => state.snapshot,
    (snapshot) => {
      if (!alive || !snapshot) return;
      if (cacheTimer) clearTimeout(cacheTimer);
      cacheTimer = setTimeout(() => {
        cacheTimer = undefined;
        const confirmed = store.getState().confirmedSnapshot();
        if (alive && confirmed)
          void mobilePersistence.saveHomeSnapshot(session, confirmed).catch(() => undefined);
      }, 3_000);
    },
  );

  const disconnect = () => {
    alive = false;
    if (cacheTimer) clearTimeout(cacheTimer);
    if (preferencesTimer) clearInterval(preferencesTimer);
    preferencesTimer = undefined;
    preferenceListeners.clear();
    helper.dispose();
    cacheTimer = undefined;
    stopConnection();
    stopSnapshot();
    store.getState().dispose();
    transport?.close();
    transport = undefined;
  };

  const reconnect = async () => {
    if (!alive) return;
    await store.getState().connectHome(homeId, store.getState().snapshot ?? undefined);
    await bootstrap();
  };

  const logout = async () => {
    if (!alive) return;
    const currentAuth = auth;
    disconnect();
    try {
      await currentAuth.revoke();
    } catch {
      // Local sign-out and cache deletion must work while Home Assistant is offline.
    }
    await mobilePersistence.clearSession();
  };

  void store
    .getState()
    .connectHome(homeId, cached?.snapshot)
    .catch(() => undefined);
  void bootstrap();
  setActive(true);

  return {
    store,
    session,
    get preferences() {
      return preferences;
    },
    subscribePreferences(listener) {
      preferenceListeners.add(listener);
      return () => preferenceListeners.delete(listener);
    },
    setActive,
    reconnect,
    logout,
    dispose: disconnect,
  };
}
