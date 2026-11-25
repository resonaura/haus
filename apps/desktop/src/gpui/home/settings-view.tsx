/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import {
  buildDemoBridgeSuggestions,
  fetchBridgeSuggestions,
  type BridgeSuggestion,
  type ManagementPort,
} from '@haus/core/transport';
import type { Preferences } from '@haus/ha/view/preferences';
import { ICON_APPEARANCES, ICON_TINT_COLORS, ICON_VARIATIONS } from '@haus/icons';
import {
  BridgeSuggestionsPanel,
  IconStylePanel,
  LiquidGlassSettingsPanel,
  SettingsPanel,
  type SettingsDestination,
} from '@haus/ui/components';
import desktopPackage from '../../../package.json' with { type: 'json' };

export interface HomeSessionStatusInfo {
  readonly hasSession: boolean;
  readonly url?: string;
  readonly kind?: 'haus-hub' | 'home-assistant';
  readonly statusText: string;
  readonly syncStatus: 'syncing' | 'synced' | 'offline';
}

export function SettingsView({
  demo,
  homeName,
  versionText,
  preferences,
  disabled = false,
  canEditPreferences = true,
  sessionMeta,
  management,
  sessionKind,
  onToggleDemo,
  onConnect,
  onDisconnect,
  onTheme,
  onGrouping,
  onPreferencesPatch,
  onResetLightGroups,
  onNavigate,
}: {
  demo: boolean;
  homeName: string;
  versionText?: string;
  preferences: Preferences;
  disabled?: boolean;
  canEditPreferences?: boolean;
  sessionMeta?: HomeSessionStatusInfo;
  management?: ManagementPort;
  sessionKind?: 'haus-hub' | 'home-assistant';
  onToggleDemo?: (enabled: boolean) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onTheme: (theme: Preferences['theme']) => void;
  onGrouping: (enabled: boolean) => void;
  onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  onResetLightGroups?: () => void;
  onNavigate?: (destination: SettingsDestination) => void;
}) {
  const effectiveKind = sessionKind ?? sessionMeta?.kind;
  const shouldLoadBridges = demo || (effectiveKind === 'haus-hub' && Boolean(management));
  const [bridgeAttempt, setBridgeAttempt] = useState(0);
  const [bridgeState, setBridgeState] = useState<
    | { readonly status: 'loading' | 'failed'; readonly suggestions: readonly BridgeSuggestion[] }
    | { readonly status: 'loaded'; readonly suggestions: readonly BridgeSuggestion[] }
  >(() =>
    demo
      ? { status: 'loaded', suggestions: buildDemoBridgeSuggestions() }
      : { status: 'loading', suggestions: [] },
  );

  useEffect(() => {
    if (demo) {
      setBridgeState({ status: 'loaded', suggestions: buildDemoBridgeSuggestions() });
      return;
    }
    if (effectiveKind !== 'haus-hub' || !management) {
      return;
    }
    let active = true;
    setBridgeState({ status: 'loading', suggestions: [] });
    void fetchBridgeSuggestions(management)
      .then((suggestions) => {
        if (active) setBridgeState({ status: 'loaded', suggestions });
      })
      .catch(() => {
        if (active) setBridgeState({ status: 'failed', suggestions: [] });
      });
    return () => {
      active = false;
    };
  }, [bridgeAttempt, demo, effectiveKind, management, sessionMeta?.url]);

  const hasSession = sessionMeta?.hasSession ?? !demo;
  const statusText = demo
    ? hasSession
      ? 'Demo mode (live home paused)'
      : 'Exploring demo'
    : (sessionMeta?.statusText ?? 'Connected');
  const syncStatusText = demo
    ? 'Local demo'
    : sessionMeta?.syncStatus === 'synced'
      ? 'Saved on your hub'
      : sessionMeta?.syncStatus === 'syncing'
        ? 'Synchronizing…'
        : sessionMeta?.syncStatus === 'offline'
          ? 'Saved locally · hub sync will retry'
          : 'Local cache';

  return (
    <SettingsPanel
      mode={demo ? 'demo' : 'live'}
      homeName={homeName}
      statusText={statusText}
      address={sessionMeta?.url}
      versionText={versionText ?? (demo && !hasSession ? 'Demo' : 'Connected')}
      serverKindLabel={sessionMeta?.kind === 'home-assistant' ? 'Home Assistant' : 'Haus Hub'}
      hasSession={hasSession}
      theme={preferences.theme}
      autoGroupLights={preferences.autoGroupLights !== false}
      disabledLightGroupsCount={preferences.disabledLightGroups?.length ?? 0}
      favoritesCount={preferences.favorites.length}
      syncStatusText={syncStatusText}
      appVersion={desktopPackage.version}
      busy={disabled}
      onToggleDemo={onToggleDemo}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
      onTheme={onTheme}
      onGrouping={onGrouping}
      onResetLightGroups={canEditPreferences ? onResetLightGroups : undefined}
      onNavigate={onNavigate}
      iconPicker={
        onPreferencesPatch ? (
          <IconStylePanel
            appearance={preferences.iconAppearance ?? 'default'}
            variation={preferences.iconVariation ?? 'auto'}
            tintColor={preferences.iconTintColor ?? 'automatic'}
            appearances={ICON_APPEARANCES}
            variations={ICON_VARIATIONS}
            tintColors={ICON_TINT_COLORS}
            onChangeAppearance={(iconAppearance) => onPreferencesPatch({ iconAppearance })}
            onChangeVariation={(iconVariation) => onPreferencesPatch({ iconVariation })}
            onChangeTintColor={(iconTintColor) => onPreferencesPatch({ iconTintColor })}
          />
        ) : undefined
      }
      glassPanel={
        onPreferencesPatch ? (
          <LiquidGlassSettingsPanel
            value={preferences.liquidGlass}
            onChange={(liquidGlass) => onPreferencesPatch({ liquidGlass })}
          />
        ) : undefined
      }
      extra={
        shouldLoadBridges ? (
          <BridgeSuggestionsPanel
            status={bridgeState.status}
            suggestions={bridgeState.suggestions}
            onRetry={() => setBridgeAttempt((previous) => previous + 1)}
          />
        ) : undefined
      }
    />
  );
}
