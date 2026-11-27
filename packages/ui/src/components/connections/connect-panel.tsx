/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveredHomeTargetType } from '@haus/core/pairing';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import type { UiStyleSpec } from '../../ir/node.js';
import { HausButton } from '../../primitives/controls.js';
import { Box, Heading, Pressable, Row, Stack, Text } from '../../primitives/elements.js';
import { ConnectionField } from '../field.js';
import { UiIcon } from '../icon.js';

export interface DiscoveredHomeServer {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly kind?: string;
  readonly targetType?: DiscoveredHomeTargetType;
  readonly homeId?: string;
  readonly hubId?: string;
  readonly hubCount?: number;
  readonly onboarded?: boolean;
  readonly memberUrls?: readonly string[];
  readonly memberNames?: readonly string[];
}

export interface ConnectHomePanelProps {
  readonly servers: readonly DiscoveredHomeServer[];
  readonly scanning: boolean;
  readonly pending: boolean;
  readonly explicitHa: boolean;
  readonly url: string;
  readonly code: string;
  readonly pairingUrl: string | null;
  readonly error?: string | null;
  readonly showHeader?: boolean;
  readonly fieldStyle?: UiStyleSpec;
  readonly onUrlChange: (value: string) => void;
  readonly onCodeChange: (value: string) => void;
  readonly onSubmit: (address: string, selected?: DiscoveredHomeServer) => void;
  readonly onToggleExplicitHa?: (next: boolean) => void;
  readonly onScan?: () => void;
  readonly onCancelPairing?: () => void;
  readonly onClose?: () => void;
  readonly cancelLabel?: string;
}

const serverRowStyle: UiStyleSpec = {
  layout: {
    direction: 'row',
    alignItems: 'center',
    width: pct(100),
    padding: insets(11, 13),
    gap: px(12),
  },
  material: new SolidMaterial(colorToken('card')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(16),
  states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
};

const badgeStyle: UiStyleSpec = {
  layout: { padding: insets(2, 8), alignItems: 'center', justifyContent: 'center' },
  material: new SolidMaterial(colorToken('surfaceSecondary')),
  corners: corners(999),
};

const defaultFieldStyle: UiStyleSpec = {
  layout: { minHeight: px(40), padding: insets(8, 10) },
  corners: corners(10),
  border: { width: 1, color: colorToken('border') },
  material: new SolidMaterial(colorToken('surface')),
  typography: { color: colorToken('textPrimary'), size: 14 },
};

function targetBadgeLabel(server: DiscoveredHomeServer, explicitHa: boolean): string | undefined {
  if (explicitHa || server.targetType === 'home-assistant') return undefined;
  if (server.targetType === 'home-network') {
    const count = server.hubCount && server.hubCount > 1 ? server.hubCount : 2;
    return `Home network · ${count} Hubs`;
  }
  if (server.targetType === 'home') return 'Home';
  if (server.targetType === 'standalone-hub') return 'New Hub';
  return undefined;
}

function targetSubtitle(server: DiscoveredHomeServer, explicitHa: boolean): string {
  if (explicitHa || server.targetType === 'home-assistant') return server.url;
  if (server.targetType === 'home-network') {
    const names = server.memberNames?.filter(Boolean) ?? [];
    return names.length > 1 ? `Mesh: ${names.join(' · ')}` : `Automatic Hub mesh · ${server.url}`;
  }
  if (server.targetType === 'home') {
    return `Configured home · ${server.url.replace(/^https?:\/\//, '')}`;
  }
  if (server.targetType === 'standalone-hub') {
    return `Set up as a new home · ${server.url.replace(/^https?:\/\//, '')}`;
  }
  return server.url;
}

function targetIconName(
  server: DiscoveredHomeServer,
  explicitHa: boolean,
): 'wifi' | 'layers' | 'server' | 'house' {
  if (explicitHa || server.targetType === 'home-assistant') return 'wifi';
  if (server.targetType === 'home-network') return 'layers';
  if (server.targetType === 'standalone-hub') return 'server';
  return 'house';
}

export function ConnectHomePanel({
  servers,
  scanning,
  pending,
  explicitHa,
  url,
  code,
  pairingUrl,
  error,
  showHeader = true,
  fieldStyle = defaultFieldStyle,
  onUrlChange,
  onCodeChange,
  onSubmit,
  onToggleExplicitHa,
  onScan,
  onCancelPairing,
  onClose,
  cancelLabel = 'Keep exploring for now',
}: ConnectHomePanelProps) {
  const submitDisabled = pending || (pairingUrl ? !code.trim() : !url.trim());
  const primaryHomes = explicitHa
    ? servers
    : servers.filter((s) => s.targetType !== 'standalone-hub');
  const standaloneHubs = explicitHa ? [] : servers.filter((s) => s.targetType === 'standalone-hub');

  const renderServerRow = (server: DiscoveredHomeServer) => {
    const badge = targetBadgeLabel(server, explicitHa);
    return (
      <Pressable
        key={server.id || server.url}
        id={`discovered-${server.id}`}
        style={serverRowStyle}
        disabled={pending}
        onActivate={() => onSubmit(server.url, server)}
      >
        <Box
          style={{
            layout: {
              width: px(36),
              height: px(36),
              alignItems: 'center',
              justifyContent: 'center',
            },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            corners: corners(11),
          }}
        >
          <UiIcon name={targetIconName(server, explicitHa)} size={17} />
        </Box>
        <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
          <Row align="center" gapPx={8} wrap>
            <Text size={13.5} weight={600}>
              {server.name}
            </Text>
            {badge && (
              <Box style={badgeStyle}>
                <Text size={10.5} weight={600} tone="muted">
                  {badge}
                </Text>
              </Box>
            )}
          </Row>
          <Text size={11.5} tone="muted">
            {targetSubtitle(server, explicitHa)}
          </Text>
        </Stack>
        <UiIcon name="arrow-right" size={16} />
      </Pressable>
    );
  };

  return (
    <Stack gapPx={16} style={{ layout: { width: pct(100), maxWidth: px(480), gap: px(16) } }}>
      {showHeader && (
        <Row align="center" gapPx={12}>
          <Box
            style={{
              layout: {
                width: px(52),
                height: px(52),
                alignItems: 'center',
                justifyContent: 'center',
              },
              material: new SolidMaterial(colorToken('card')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(18),
            }}
          >
            <UiIcon name="house" size={26} strokeWidth={1.5} />
          </Box>
          <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Heading level={2} size={19}>
              Let’s bring your home closer.
            </Heading>
            <Text size={12} tone="muted">
              {explicitHa
                ? 'Connect Home Assistant and all your rooms, accessories, and scenes will feel right at home.'
                : 'Choose your Home or set up a new Haus Hub on your local network.'}
            </Text>
          </Stack>
        </Row>
      )}

      <Stack gapPx={8}>
        <Row justify="between" align="center">
          <Row gapPx={6} align="center">
            <UiIcon name={scanning ? 'loader-circle' : 'radio'} size={14} />
            <Text size={11} weight={600} tone="muted">
              {scanning
                ? explicitHa
                  ? 'Looking for Home Assistant…'
                  : 'Looking for Homes & Haus Hubs…'
                : primaryHomes.length > 0
                  ? explicitHa
                    ? 'FOUND ON YOUR NETWORK'
                    : 'HOMES ON YOUR NETWORK'
                  : standaloneHubs.length > 0
                    ? 'NEW HUBS AVAILABLE FOR SETUP'
                    : explicitHa
                      ? 'YOUR HOME ASSISTANT'
                      : 'YOUR HOME OR HAUS HUB'}
            </Text>
          </Row>
          {!pairingUrl && onScan && (
            <HausButton
              id="hub-discover"
              variant="ghost"
              size="sm"
              disabled={pending || scanning}
              onPress={onScan}
            >
              {scanning ? 'Scanning…' : 'Rescan'}
            </HausButton>
          )}
        </Row>

        {!pairingUrl && primaryHomes.map(renderServerRow)}

        {!pairingUrl && standaloneHubs.length > 0 && (
          <Stack
            gapPx={8}
            style={{ layout: { padding: insets(primaryHomes.length > 0 ? 6 : 0, 0, 0, 0) } }}
          >
            {primaryHomes.length > 0 && (
              <Text size={11} weight={600} tone="muted">
                NEW HUBS AVAILABLE FOR SETUP
              </Text>
            )}
            {standaloneHubs.map(renderServerRow)}
            {primaryHomes.length > 0 && (
              <Text size={11.5} tone="muted">
                Want to add a new Hub into your existing Home network? Open your Home first, then go
                to Servers → Add Hub.
              </Text>
            )}
          </Stack>
        )}
      </Stack>

      <Stack gapPx={10}>
        {!pairingUrl ? (
          <ConnectionField
            id="hub-url"
            value={url}
            onChange={onUrlChange}
            onSubmit={() => {
              if (!submitDisabled) onSubmit(url);
            }}
            label={explicitHa ? 'Home Assistant address' : 'Home or Hub address'}
            placeholder={
              explicitHa ? 'http://homeassistant.local:8123' : 'http://192.168.4.44:8790'
            }
            style={fieldStyle}
            maxLength={2048}
            disabled={pending}
            hint={
              explicitHa
                ? 'You’ll sign in securely in your browser. No API token needed.'
                : 'Connecting to any Hub in a Home automatically links you to the full Hub network.'
            }
          />
        ) : (
          <ConnectionField
            id="hub-code"
            value={code}
            onChange={onCodeChange}
            onSubmit={() => {
              if (!submitDisabled) onSubmit(pairingUrl);
            }}
            label="Pairing code"
            placeholder="8 characters displayed on your other device"
            hint="Enter the code shown on an already-connected device in your Home."
            style={fieldStyle}
            maxLength={32}
            disabled={pending}
            autoFocus
          />
        )}

        {error && (
          <Text tone="critical" role="alert" size={12}>
            {error}
          </Text>
        )}

        <Row gapPx={8} align="center">
          <HausButton
            id="hub-connect"
            disabled={submitDisabled}
            onPress={() => onSubmit(pairingUrl ?? url)}
          >
            {pending
              ? 'Connecting…'
              : explicitHa
                ? 'Connect Home Assistant'
                : pairingUrl
                  ? 'Pair with this Home'
                  : 'Connect'}
            <UiIcon name="arrow-right" size={15} />
          </HausButton>
          {pairingUrl && onCancelPairing && (
            <HausButton
              id="hub-cancel-pairing"
              variant="ghost"
              disabled={pending}
              onPress={onCancelPairing}
            >
              Cancel
            </HausButton>
          )}
        </Row>
      </Stack>

      <Row justify="between" align="center" gapPx={12}>
        {onToggleExplicitHa ? (
          <HausButton
            id="hub-explicit-ha"
            variant="ghost"
            size="sm"
            disabled={pending || Boolean(pairingUrl)}
            onPress={() => onToggleExplicitHa(!explicitHa)}
          >
            {explicitHa
              ? '← Connect to a Haus Home instead'
              : 'Have Home Assistant? Add or import it explicitly'}
          </HausButton>
        ) : (
          <Box />
        )}
        {onClose && (
          <HausButton id="hub-close" variant="ghost" size="sm" disabled={pending} onPress={onClose}>
            {cancelLabel}
          </HausButton>
        )}
      </Row>
    </Stack>
  );
}
