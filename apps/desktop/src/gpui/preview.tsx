/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useRef, useState } from 'react';
import type { KeyEvent } from '@gpuix/react';
import { RegistryController } from '@haus/ha/ui/registry';
import { defaults } from '@haus/ha/view/preferences';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { applyDemoAction } from '@haus/ha/view/demo/action';
import type { SidebarBackdrop } from '../platform/sidebar.js';
import type { GpuiPlatform } from './platform.js';
import { availableAction, updateFavorite } from './home/model.js';
import type { HomeSessionStatusInfo } from './home/settings-view.js';
import { HomeWorkspace } from './home/workspace.js';

export const demoLamp = 'light.corner_lamp';

export function Preview({
  platform,
  sidebar,
  subscribeKeyDown,
  onConnect,
  onDisconnect,
  onToggleDemo,
  sessionMeta,
  systemTheme,
}: {
  platform: GpuiPlatform;
  sidebar?: SidebarBackdrop;
  subscribeKeyDown?: (listener: (event: KeyEvent) => void) => () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onToggleDemo?: (enabled: boolean) => void;
  sessionMeta?: HomeSessionStatusInfo;
  systemTheme?: 'light' | 'dark';
}) {
  const [snapshot, setSnapshot] = useState(createDemoSnapshot);
  const [preferences, setPreferences] = useState(defaults);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const [registry] = useState(
    () =>
      new RegistryController({
        snapshot: () => latest.current,
        context: () => ({ mode: 'demo', generation: 0, status: 'connected' }),
        commit: setSnapshot,
        request: async () => {
          throw new Error('The demo home has no remote registry.');
        },
      }),
  );
  return (
    <HomeWorkspace
      snapshot={snapshot}
      registry={registry}
      preferences={preferences}
      platform={platform}
      sidebar={sidebar}
      subscribeKeyDown={subscribeKeyDown}
      demo
      canFavorite
      sessionMeta={sessionMeta}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
      onToggleDemo={onToggleDemo}
      systemTheme={systemTheme}
      onControl={(id, intent, value) => {
        const action = availableAction(snapshot, id, intent, value);
        if (!action) return;
        setSnapshot((value) => applyDemoAction(value, action));
        setPreferences((value) => {
          const previous = value.manualUsage[id];
          return {
            ...value,
            manualUsage: {
              ...value.manualUsage,
              [id]: { count: (previous?.count ?? 0) + 1, lastUsed: Date.now() },
            },
          };
        });
        platform.hapticFeedback?.('alignment');
      }}
      onFavorite={(id, favorite) =>
        setPreferences((value) => updateFavorite(snapshot, value, id, favorite) ?? value)
      }
      onTheme={(theme) => setPreferences((value) => ({ ...value, theme }))}
      onGrouping={(autoGroupLights) => setPreferences((value) => ({ ...value, autoGroupLights }))}
      onPreferencesPatch={(patch) => setPreferences((value) => ({ ...value, ...patch }))}
      onResetLightGroups={() =>
        setPreferences((value) => ({ ...value, disabledLightGroups: [] }))
      }
    />
  );
}
