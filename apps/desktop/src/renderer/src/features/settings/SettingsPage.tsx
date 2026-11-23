/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { version as appVersion } from '../../../../../package.json';
import {
  Box as UiBox,
  HausButton,
  HausSegmentedControl,
  HausSwitch,
  Heading,
  Pressable,
  Text,
} from '@haus/ui';
import { House, ArrowRight, LayoutGrid, ChevronRight, Cable, Box } from 'lucide-react';
import type { HausController } from '../../hooks/useHaus';
import { triggerDemoMode } from '../../hooks/demo-override';
import type { Route } from '../../app/navigation';
import { titleCase } from '../../model/presentation';
import { BridgeSuggestions } from './bridges';
import { IconAppearancePicker } from './IconAppearancePicker';
import { LiquidGlassSettingsPanel } from './LiquidGlassSettingsPanel';

type Props = Pick<
  HausController,
  'mode' | 'snapshot' | 'status' | 'preferences' | 'session' | 'savePreferences' | 'preferenceSync'
> & {
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
  go: (route: Route) => void;
};
export function SettingsPage({
  mode,
  snapshot,
  status,
  preferences,
  preferenceSync,
  session,
  savePreferences,
  onConnect,
  onDisconnect,
  go,
}: Props) {
  return (
    <UiBox className="settings-layout">
      <UiBox className="settings-card">
        <UiBox className="settings-card-title">
          <Text className="settings-icon">
            <House size={24} />
          </Text>
          <UiBox>
            <Heading level={2}>Your home, connected.</Heading>
            <Text semantic="p">Haus Hub keeps everything in sync.</Text>
          </UiBox>
        </UiBox>
        <UiBox className="settings-row">
          <Text>Home</Text>
          <Text semantic="strong">
            {mode === 'demo'
              ? `${snapshot.config.location_name} · Demo`
              : snapshot.config.location_name}
          </Text>
        </UiBox>
        <UiBox className="settings-row">
          <Text>Connection</Text>
          <Text semantic="strong" className="connection-value">
            <Text semantic="swatch" />
            {mode === 'demo'
              ? session
                ? 'Demo mode (live home paused)'
                : 'Exploring demo'
              : titleCase(status)}
          </Text>
        </UiBox>
        {session && (
          <UiBox className="settings-row">
            <Text>Address</Text>
            <Text semantic="strong">{session.url}</Text>
          </UiBox>
        )}
        <UiBox className="settings-row">
          <Text>Haus Hub</Text>
          <Text semantic="strong">{snapshot.config.version ?? 'Demo'}</Text>
        </UiBox>
        <UiBox className="settings-row">
          <UiBox>
            <Text surfaceTokens={{ display: 'block' }}>Demo mode</Text>
            <Text semantic="small" surfaceTokens={{ opacity: 0.68, fontSize: '11.5px' }}>
              {session
                ? 'Use fictional sample devices offline while keeping your saved home connection.'
                : 'Exploring sample home until you connect a Haus Hub.'}
            </Text>
          </UiBox>
          <HausSwitch
            aria-label="Demo mode"
            isSelected={mode === 'demo'}
            isDisabled={!session && mode === 'demo'}
            onChange={(enabled) => triggerDemoMode(enabled)}
          />
        </UiBox>
        <UiBox className="settings-card-actions">
          {mode === 'demo' && session ? (
            <HausButton onPress={() => triggerDemoMode(false)}>
              Return to live home
              <ArrowRight size={16} />
            </HausButton>
          ) : (
            <HausButton onPress={() => onConnect()}>
              {session ? 'Manage connection' : 'Connect Haus Hub'}
              <ArrowRight size={16} />
            </HausButton>
          )}
          {session && mode === 'demo' && (
            <HausButton variant="secondary" onPress={() => onConnect()}>
              Manage connection
            </HausButton>
          )}
          {session && (
            <HausButton variant="ghost" onPress={() => void onDisconnect()}>
              Disconnect
            </HausButton>
          )}
        </UiBox>
      </UiBox>
      <UiBox className="settings-card">
        <Heading level={2}>A space that feels like you.</Heading>
        <Text semantic="p">Make a few little adjustments.</Text>
        <UiBox className="settings-row">
          <Text>Appearance</Text>
          <HausSegmentedControl
            aria-label="Appearance"
            value={preferences.theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(theme) => savePreferences({ theme })}
          />
        </UiBox>
        <IconAppearancePicker
          appearance={preferences.iconAppearance ?? 'default'}
          variation={preferences.iconVariation ?? 'auto'}
          tintColor={preferences.iconTintColor ?? 'automatic'}
          systemDark={
            preferences.theme === 'dark' ||
            (preferences.theme === 'system' &&
              typeof document !== 'undefined' &&
              document.documentElement.dataset.theme === 'dark')
          }
          isHubConnected={mode === 'live' && session?.kind === 'haus-hub'}
          onChange={(patch) => savePreferences(patch)}
        />
        <LiquidGlassSettingsPanel
          value={preferences.liquidGlass}
          onChange={(liquidGlass) => savePreferences({ liquidGlass })}
        />
        <UiBox className="settings-row">
          <Text>Group numbered lights</Text>
          <HausSwitch
            aria-label="Group numbered lights"
            isSelected={preferences.autoGroupLights !== false}
            onChange={(autoGroupLights) => savePreferences({ autoGroupLights })}
          />
        </UiBox>
        <Text semantic="p" className="settings-note">
          Combine matching numbered lights in the same room. Each group can also be shown
          separately.
        </Text>
        {!!preferences.disabledLightGroups?.length && (
          <HausButton variant="ghost" onPress={() => savePreferences({ disabledLightGroups: [] })}>
            Reset separated light groups
          </HausButton>
        )}
        <UiBox className="settings-row">
          <Text>Favorites</Text>
          <Text semantic="strong">
            {preferences.favorites.length}{' '}
            {preferences.favorites.length === 1 ? 'accessory' : 'accessories'}
          </Text>
        </UiBox>
        <UiBox className="settings-row">
          <Text>Shared home layout</Text>
          <Text>
            {mode === 'demo'
              ? 'Local demo'
              : preferenceSync === 'synced'
                ? 'Saved on your hub'
                : preferenceSync === 'syncing'
                  ? 'Synchronizing…'
                  : preferenceSync === 'offline'
                    ? 'Saved locally · hub sync will retry'
                    : 'Local cache'}
          </Text>
        </UiBox>
        <UiBox className="settings-row">
          <Text>Notifications</Text>
          <Text>Low batteries, leaks & offline devices</Text>
        </UiBox>
      </UiBox>
      <UiBox className="settings-card">
        <Heading level={2}>Connections & services.</Heading>
        <Text semantic="p">Everything that connects and powers your home.</Text>
        <Pressable className="settings-destination" onPress={() => go({ kind: 'rooms' })}>
          <House size={19} />
          <Text>
            Rooms<Text semantic="small">Organize spaces, names and room icons</Text>
          </Text>
          <ChevronRight size={17} />
        </Pressable>
        <Pressable className="settings-destination" onPress={() => go({ kind: 'devices' })}>
          <LayoutGrid size={19} />
          <Text>
            Device catalog
            <Text semantic="small">Every registered device, including diagnostics</Text>
          </Text>
          <ChevronRight size={17} />
        </Pressable>
        <Pressable className="settings-destination" onPress={() => go({ kind: 'integrations' })}>
          <Cable size={19} />
          <Text>
            Integrations<Text semantic="small">Connections, configuration and status</Text>
          </Text>
          <ChevronRight size={17} />
        </Pressable>
        <Pressable className="settings-destination" onPress={() => go({ kind: 'addons' })}>
          <Box size={19} />
          <Text>
            Apps<Text semantic="small">Managed apps, bridges and available updates</Text>
          </Text>
          <ChevronRight size={17} />
        </Pressable>
      </UiBox>
      <Pressable
        className="settings-destination settings-card"
        onPress={() => go({ kind: 'servers' })}
      >
        <Box size={22} />
        <Text>
          Servers & backups
          <Text semantic="small">Haus Hub, connected machines and recovery copies</Text>
        </Text>
        <ChevronRight size={17} />
      </Pressable>
      {mode === 'live' && session?.kind === 'haus-hub' && <BridgeSuggestions key={session.url} />}
      <UiBox className="settings-about">
        <Text>Version {appVersion} · Thoughtfully connected.</Text>
      </UiBox>
    </UiBox>
  );
}
