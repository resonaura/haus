/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import type { UiStyleSpec } from '../../ir/node.js';
import { HausButton, HausSegmentedControl, HausSwitch } from '../../primitives/controls.js';
import { Box, Divider, Heading, Pressable, Row, Stack, Text } from '../../primitives/elements.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export type SettingsDestination = 'rooms' | 'devices' | 'integrations' | 'addons' | 'servers';

export interface SettingsPanelProps {
  readonly mode: 'live' | 'demo';
  readonly homeName: string;
  readonly statusText: string;
  readonly address?: string;
  readonly versionText: string;
  readonly serverKindLabel?: string;
  readonly hasSession: boolean;
  readonly theme: 'system' | 'light' | 'dark';
  readonly autoGroupLights: boolean;
  readonly disabledLightGroupsCount: number;
  readonly favoritesCount: number;
  readonly syncStatusText: string;
  readonly appVersion: string;
  readonly busy?: boolean;
  readonly onToggleDemo?: (enabled: boolean) => void;
  readonly onConnect?: () => void;
  readonly onDisconnect?: () => void;
  readonly onTheme: (theme: 'system' | 'light' | 'dark') => void;
  readonly onGrouping: (enabled: boolean) => void;
  readonly onResetLightGroups?: () => void;
  readonly onNavigate?: (destination: SettingsDestination) => void;
  readonly iconPicker?: ReactNode;
  readonly glassPanel?: ReactNode;
  readonly extra?: ReactNode;
}

const cardStyle: UiStyleSpec = {
  layout: { width: pct(100), padding: insets(20), gap: px(14) },
  material: new SolidMaterial(colorToken('card')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(24),
};

const iconBadgeStyle: UiStyleSpec = {
  layout: { width: px(42), height: px(42), alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  material: new SolidMaterial(colorToken('surfaceSecondary')),
  border: { width: 1, color: colorToken('borderSubtle') },
  corners: corners(14),
};

const destinationStyle: UiStyleSpec = {
  layout: {
    direction: 'row',
    alignItems: 'center',
    width: pct(100),
    padding: insets(11, 12),
    gap: px(12),
  },
  corners: corners(14),
  states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
};

function SettingRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Row justify="between" align="center" gapPx={12}>
      <Text size={13} tone="secondary">
        {label}
      </Text>
      {typeof value === 'string' ? (
        <Text size={13} weight={600}>
          {value}
        </Text>
      ) : (
        value
      )}
    </Row>
  );
}

function DestinationRow({
  id,
  icon,
  title,
  description,
  onPress,
}: {
  id: string;
  icon: UiIconName;
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable id={id} style={destinationStyle} onActivate={onPress}>
      <UiIcon name={icon} size={18} />
      <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
        <Text size={13} weight={600}>
          {title}
        </Text>
        <Text size={11} tone="muted">
          {description}
        </Text>
      </Stack>
      <UiIcon name="chevron-right" size={16} />
    </Pressable>
  );
}

export function SettingsPanel({
  mode,
  homeName,
  statusText,
  address,
  versionText,
  serverKindLabel = 'Haus Hub',
  hasSession,
  theme,
  autoGroupLights,
  disabledLightGroupsCount,
  favoritesCount,
  syncStatusText,
  appVersion,
  busy = false,
  onToggleDemo,
  onConnect,
  onDisconnect,
  onTheme,
  onGrouping,
  onResetLightGroups,
  onNavigate,
  iconPicker,
  glassPanel,
  extra,
}: SettingsPanelProps) {
  return (
    <Stack gapPx={16} style={{ layout: { maxWidth: px(760), width: pct(100), gap: px(16) } }}>
      <Stack style={cardStyle} gapPx={14}>
        <Row gapPx={14} align="center">
          <Box style={iconBadgeStyle}>
            <UiIcon name="house" size={21} />
          </Box>
          <Stack gapPx={2}>
            <Heading level={2} size={17}>
              Your home, connected.
            </Heading>
            <Text size={12} tone="muted">
              Haus Hub keeps everything in sync.
            </Text>
          </Stack>
        </Row>
        <Divider />
        <SettingRow label="Home" value={mode === 'demo' ? `${homeName} · Demo` : homeName} />
        <SettingRow
          label="Connection"
          value={
            <Row gapPx={8} align="center">
              <Box
                style={{
                  layout: { width: px(7), height: px(7) },
                  corners: corners(4),
                  material: new SolidMaterial(
                    colorToken(mode === 'demo' ? 'warning' : hasSession ? 'success' : 'textMuted'),
                  ),
                }}
              />
              <Text size={13} weight={600}>
                {statusText}
              </Text>
            </Row>
          }
        />
        {address && <SettingRow label="Address" value={address} />}
        <SettingRow label={serverKindLabel} value={versionText} />
        <Row justify="between" align="center" gapPx={14}>
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={13} weight={600}>
              Demo mode
            </Text>
            <Text size={11} tone="muted">
              {hasSession
                ? 'Use fictional sample devices offline while keeping your saved home connection.'
                : 'Exploring sample home until you connect a Haus Hub.'}
            </Text>
          </Stack>
          <HausSwitch
            id="settings-demo-mode"
            aria-label="Demo mode"
            isSelected={mode === 'demo'}
            isDisabled={busy || (!hasSession && mode === 'demo') || !onToggleDemo}
            onChange={(enabled) => onToggleDemo?.(enabled)}
          />
        </Row>
        <Row gapPx={10} align="center">
          {mode === 'demo' && hasSession && onToggleDemo ? (
            <HausButton id="settings-return-live" disabled={busy} onPress={() => onToggleDemo(false)}>
              Return to live home
              <UiIcon name="arrow-right" size={15} />
            </HausButton>
          ) : (
            onConnect && (
              <HausButton id="settings-connect" disabled={busy} onPress={onConnect}>
                {hasSession ? 'Manage connection' : 'Connect Haus Hub'}
                <UiIcon name="arrow-right" size={15} />
              </HausButton>
            )
          )}
          {hasSession && mode === 'demo' && onConnect && (
            <HausButton id="settings-manage-connection" variant="secondary" disabled={busy} onPress={onConnect}>
              Manage connection
            </HausButton>
          )}
          {hasSession && onDisconnect && (
            <HausButton id="settings-disconnect" variant="ghost" disabled={busy} onPress={onDisconnect}>
              Disconnect
            </HausButton>
          )}
        </Row>
      </Stack>

      <Stack style={cardStyle} gapPx={14}>
        <Stack gapPx={2}>
          <Heading level={2} size={17}>
            A space that feels like you.
          </Heading>
          <Text size={12} tone="muted">
            Make a few little adjustments.
          </Text>
        </Stack>
        <Divider />
        <Row justify="between" align="center" gapPx={12}>
          <Text size={13}>Appearance</Text>
          <HausSegmentedControl
            id="theme"
            aria-label="Appearance"
            value={theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={onTheme}
          />
        </Row>
        {iconPicker}
        {glassPanel}
        <Stack gapPx={6}>
          <Row justify="between" align="center" gapPx={12}>
            <Text size={13}>Group numbered lights</Text>
            <HausSwitch
              id="group-lights"
              aria-label="Group numbered lights"
              isSelected={autoGroupLights}
              isDisabled={busy}
              onChange={onGrouping}
            />
          </Row>
          <Text size={11} tone="muted">
            Combine matching numbered lights in the same room. Each group can also be shown
            separately.
          </Text>
          {disabledLightGroupsCount > 0 && onResetLightGroups && (
            <Row>
              <HausButton
                id="settings-reset-light-groups"
                variant="ghost"
                disabled={busy}
                onPress={onResetLightGroups}
              >
                Reset separated light groups
              </HausButton>
            </Row>
          )}
        </Stack>
        <Divider />
        <SettingRow
          label="Favorites"
          value={`${favoritesCount} ${favoritesCount === 1 ? 'accessory' : 'accessories'}`}
        />
        <SettingRow label="Shared home layout" value={syncStatusText} />
        <SettingRow label="Notifications" value="Low batteries, leaks & offline devices" />
      </Stack>

      {onNavigate && (
        <>
          <Stack style={cardStyle} gapPx={6}>
            <Stack gapPx={2} style={{ layout: { margin: insets(0, 0, 6, 0) } }}>
              <Heading level={2} size={17}>
                Connections & services.
              </Heading>
              <Text size={12} tone="muted">
                Everything that connects and powers your home.
              </Text>
            </Stack>
            <DestinationRow
              id="settings-nav-rooms"
              icon="house"
              title="Rooms"
              description="Organize spaces, names and room icons"
              onPress={() => onNavigate('rooms')}
            />
            <DestinationRow
              id="settings-nav-devices"
              icon="layout-grid"
              title="Device catalog"
              description="Every registered device, including diagnostics"
              onPress={() => onNavigate('devices')}
            />
            <DestinationRow
              id="settings-nav-integrations"
              icon="cable"
              title="Integrations"
              description="Connections, configuration and status"
              onPress={() => onNavigate('integrations')}
            />
            <DestinationRow
              id="settings-nav-addons"
              icon="box"
              title="Apps"
              description="Managed apps, bridges and available updates"
              onPress={() => onNavigate('addons')}
            />
          </Stack>
          <Box style={{ ...cardStyle, layout: { padding: insets(8, 10) } }}>
            <DestinationRow
              id="settings-nav-servers"
              icon="server"
              title="Servers & backups"
              description="Haus Hub, connected machines and recovery copies"
              onPress={() => onNavigate('servers')}
            />
          </Box>
        </>
      )}

      {extra}

      <Row justify="center" style={{ layout: { padding: insets(4, 0, 12, 0) } }}>
        <Text size={11} tone="muted">
          Version {appVersion} · Thoughtfully connected.
        </Text>
      </Row>
    </Stack>
  );
}
