/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { WebStorageDemoModeStore } from '@haus/core/transport';
import type { HausNative } from '../../../shared/native';
import { loadHueSceneArtwork } from '../ha/hue-scenes';
import { loadLastLightOutput } from '../ha/light-history';
import { getHomeTransport } from '../app/transport';
import type { HassEntity, Snapshot } from '../model';
import type { OptimisticState } from '../model/optimistic';

const demoModeStore = new WebStorageDemoModeStore('haus.demoMode');

type DemoModeSetter = (enabled: boolean) => void;

let registeredSetter: DemoModeSetter | null = null;

/** Reads whether local demo mode override is currently active for this app instance. */
export function readLocalDemoMode(): boolean {
  return demoModeStore.read();
}

/** Persists local demo mode override without affecting hub-synced home preferences. */
export function writeLocalDemoMode(enabled: boolean): void {
  demoModeStore.write(enabled);
}

/** Registers the active `useHaus` demo-mode switcher so Settings and Startup can toggle it directly. */
export function registerDemoModeSetter(setter: DemoModeSetter): () => void {
  registeredSetter = setter;
  return () => {
    if (registeredSetter === setter) registeredSetter = null;
  };
}

/** Switches between local demo mode and the configured live home session via the shared transport. */
export function triggerDemoMode(enabled: boolean): void {
  demoModeStore.write(enabled);
  if (registeredSetter) {
    registeredSetter(enabled);
    return;
  }
  getHomeTransport().setMode(enabled ? 'demo' : 'live');
}

export function formatHomeStartupError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/saved session could not be unlocked/i.test(detail))
    return 'Your saved sign-in needs to be restored. Manage the connection to sign in again.';
  const hubFailure = detail.match(/The Hub request failed \(\d{3}(?:: [a-z0-9_]{1,96})?\)\.?/i);
  if (hubFailure) return `Could not load your Haus Hub: ${hubFailure[0]}`;

  const safeDetail = detail
    .replace(/https?:\/\/[^\s)'"<>]+/gi, '[address]')
    .replace(/\b(bearer|token|authorization)\s*[:=]?\s*[^\s,;]+/gi, '$1 [redacted]')
    .replace(/\b[a-f\d]{40,}\b/gi, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 180);
  if (safeDetail) return `Could not load your home: ${safeDetail}`;
  return 'Could not load your home. Check the connection and try again, or manage the connection.';
}

export async function fetchSceneConfigs(
  api: HausNative,
  states: Snapshot['states'],
  entities: Snapshot['entities'],
): Promise<NonNullable<Snapshot['sceneConfigs']> | null> {
  const sceneEntities = states.filter(
    (entity) =>
      entity.entity_id.startsWith('scene.') &&
      typeof entity.attributes.id === 'string' &&
      /^[a-z0-9_-]{1,128}$/i.test(entity.attributes.id) &&
      entities.some(
        (entry) =>
          entry.entity_id === entity.entity_id &&
          (entry.platform === 'homeassistant' || entry.platform === 'haus'),
      ),
  );
  if (!sceneEntities.length) return null;
  const queue = [...sceneEntities];
  const sceneConfigs: NonNullable<Snapshot['sceneConfigs']> = {};
  const worker = async () => {
    while (queue.length) {
      const scene = queue.shift()!;
      try {
        const sceneConfig = await api.getSceneConfig(scene.entity_id, String(scene.attributes.id));
        if (sceneConfig) sceneConfigs[scene.entity_id] = sceneConfig;
      } catch {
        /* Scene settings are optional; unavailable configs do not block the home view. */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, sceneEntities.length) }, worker));
  return sceneConfigs;
}

export function hydrateLiveExtras(options: {
  readonly api: HausNative;
  readonly loaded: Snapshot;
  readonly optimistic: OptimisticState;
  readonly isActive: () => boolean;
  readonly getServerStates: () => readonly HassEntity[];
  readonly onLightRemembered: () => void;
  readonly onSnapshotPatch: (patch: Partial<Snapshot>) => void;
}): void {
  const { api, loaded, optimistic, isActive, getServerStates, onLightRemembered, onSnapshotPatch } =
    options;
  const missingOutput = loaded.states
    .filter((state) => optimistic.lightMemory.needsHistory(state))
    .map((state) => state.entity_id);
  void loadLastLightOutput(
    api,
    missingOutput,
    (id) => {
      const state = getServerStates().find((item) => item.entity_id === id);
      return isActive() && Boolean(state && optimistic.lightMemory.needsHistory(state));
    },
    (state) => {
      if (!isActive()) return;
      optimistic.lightMemory.remember(state);
      onLightRemembered();
    },
  ).catch(() => {});
  void loadHueSceneArtwork(loaded, api)
    .then((sceneArtwork) => {
      if (isActive()) onSnapshotPatch({ sceneArtwork });
    })
    .catch(() => {});
  void fetchSceneConfigs(api, loaded.states, loaded.entities).then((sceneConfigs) => {
    if (sceneConfigs && isActive()) onSnapshotPatch({ sceneConfigs });
  });
}
