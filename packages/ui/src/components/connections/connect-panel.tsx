/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

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
  readonly fieldStyle?: UiStyleSpec;
  readonly onUrlChange: (value: string) => void;
  readonly onCodeChange: (value: string) => void;
  readonly onSubmit: (address: string) => void;
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
    padding: insets(10, 12),
    gap: px(12),
  },
  material: new SolidMaterial(colorToken('card')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(16),
  states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
};

const defaultFieldStyle: UiStyleSpec = {
  layout: { minHeight: px(40), padding: insets(8, 10) },
  corners: corners(10),
  border: { width: 1, color: colorToken('border') },
  material: new SolidMaterial(colorToken('surface')),
  typography: { color: colorToken('textPrimary'), size: 14 },
};

export function ConnectHomePanel({
  servers,
  scanning,
  pending,
  explicitHa,
  url,
  code,
  pairingUrl,
  error,
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
  const submitDisabled =
    pending || (pairingUrl ? !code.trim() : !url.trim());

  return (
    <Stack gapPx={16} style={{ layout: { width: pct(100), maxWidth: px(480), gap: px(16) } }}>
      <Row align="center" gapPx={12}>
        <Box
          style={{
            layout: { width: px(52), height: px(52), alignItems: 'center', justifyContent: 'center' },
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
              : 'Connect your Haus Hub to bring all your rooms, accessories, and scenes together.'}
          </Text>
        </Stack>
      </Row>

      <Stack gapPx={8}>
        <Row justify="between" align="center">
          <Row gapPx={6} align="center">
            <UiIcon name={scanning ? 'loader-circle' : 'radio'} size={14} />
            <Text size={11} weight={600} tone="muted">
              {scanning
                ? explicitHa
                  ? 'Looking for Home Assistant…'
                  : 'Looking for your Haus Hub…'
                : servers.length
                  ? 'FOUND ON YOUR NETWORK'
                  : explicitHa
                    ? 'YOUR HOME ASSISTANT'
                    : 'YOUR HAUS HUB'}
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
              {scanning ? 'Scanning…' : 'Find Hubs'}
            </HausButton>
          )}
        </Row>

        {!pairingUrl &&
          servers.map((server) => (
            <Pressable
              key={server.id || server.url}
              id={`discovered-${server.id}`}
              style={serverRowStyle}
              disabled={pending}
              onActivate={() => onSubmit(server.url)}
            >
              <Box
                style={{
                  layout: { width: px(34), height: px(34), alignItems: 'center', justifyContent: 'center' },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  corners: corners(11),
                }}
              >
                <UiIcon name={explicitHa ? 'wifi' : 'house'} size={17} />
              </Box>
              <Stack gapPx={1} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                <Text size={13} weight={600}>
                  {server.name}
                </Text>
                <Text size={11} tone="muted">
                  {server.url}
                </Text>
              </Stack>
              <UiIcon name="arrow-right" size={16} />
            </Pressable>
          ))}
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
            label={explicitHa ? 'Home Assistant address' : 'Haus Hub address'}
            placeholder={explicitHa ? 'http://homeassistant.local:8123' : 'http://192.168.5.115:8790'}
            style={fieldStyle}
            maxLength={2048}
            disabled={pending}
            hint={
              explicitHa
                ? 'You’ll sign in securely in your browser. No API token needed.'
                : 'Enter your Haus Hub local endpoint. First connection pairs automatically.'
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
            hint="Enter the code shown on your already-connected Haus device."
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
                  ? 'Pair with this Hub'
                  : 'Connect your Haus Hub'}
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
              ? '← Connect to a Haus Hub instead'
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
