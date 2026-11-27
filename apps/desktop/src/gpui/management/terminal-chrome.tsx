/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  UiIcon,
  type ConsoleConnectionState,
  type PendingHostKeyPrompt,
} from '@haus/ui/components';
import { colorToken, corners, insets, pct, px, rgba, SolidMaterial } from '@haus/ui/ir';
import { Box, HausButton, Pressable, Row, Stack, Text, useHausUi } from '@haus/ui/primitives';

function statusDotColor(state: ConsoleConnectionState) {
  if (state === 'connected') return rgba(52, 211, 153, 1);
  if (state === 'connecting') return rgba(251, 191, 36, 1);
  if (state === 'disconnected') return colorToken('critical');
  return colorToken('textMuted');
}

export function GpuiTerminalHostKeyBanner({
  hostKey,
  onTrust,
  onDismiss,
}: {
  readonly hostKey: PendingHostKeyPrompt;
  readonly onTrust: (fingerprint: string) => void;
  readonly onDismiss: () => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  return (
    <Row
      align="center"
      justify="between"
      gapPx={12}
      wrap
      style={{
        layout: { width: pct(100), padding: insets(12, 14) },
        material: new SolidMaterial(rgba(251, 191, 36, 0.12)),
        border: { width: 1, color: rgba(251, 191, 36, 0.35) },
        corners: corners(12),
      }}
    >
      <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(200) } }}>
        <Text size={12.5} weight={600}>
          {hostKey.changed
            ? 'Host identity key changed — verify before trusting'
            : 'Verify server Ed25519 fingerprint'}
        </Text>
        <Text size={11} tone="muted" mono>
          {hostKey.fingerprint}
        </Text>
      </Stack>
      <Row align="center" gapPx={8}>
        <HausButton id="console-dismiss-host-key" variant="ghost" size="sm" onPress={onDismiss}>
          Cancel
        </HausButton>
        <HausButton
          id="console-trust-host-key"
          variant="primary"
          size="sm"
          onPress={() => onTrust(hostKey.fingerprint)}
        >
          <UiIcon name="shield-check" size={13} color={primaryFg} />
          <Text
            size={12}
            style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
          >
            Trust & connect
          </Text>
        </HausButton>
      </Row>
    </Row>
  );
}

export function GpuiTerminalFooter({
  state,
  statusLabel,
  geometry,
  readOnly,
  paused,
  copied,
  onTogglePause,
  onSwitchToLogs,
  onCopy,
  onClear,
  onReconnect,
  onToggleSearch,
}: {
  readonly state: ConsoleConnectionState;
  readonly statusLabel: string;
  readonly geometry: { readonly cols: number; readonly rows: number };
  readonly readOnly: boolean;
  readonly paused: boolean;
  readonly copied: boolean;
  readonly onTogglePause: () => void;
  readonly onSwitchToLogs?: () => void;
  readonly onCopy: () => void;
  readonly onClear: () => void;
  readonly onReconnect: () => void;
  readonly onToggleSearch: () => void;
}) {
  return (
    <Row
      align="center"
      justify="between"
      gapPx={12}
      wrap
      style={{ layout: { width: pct(100), minHeight: px(28), padding: insets(2, 2, 0, 2) } }}
    >
      <Row align="center" gapPx={6}>
        <Box
          style={{
            layout: { width: px(6), height: px(6), flexShrink: 0 },
            material: new SolidMaterial(statusDotColor(state)),
            corners: corners(3),
          }}
        />
        <UiIcon name="shield-check" size={13} />
        <Text size={11} tone="muted">
          {statusLabel}
        </Text>
      </Row>
      <Row align="center" gapPx={8}>
        <Text size={11} tone="muted" mono>
          {`${geometry.cols} × ${geometry.rows}`}
        </Text>
        {readOnly && (
          <Pressable
            id="console-pause-toggle"
            ariaLabel={paused ? 'Resume live output' : 'Pause live output'}
            onActivate={onTogglePause}
            style={{
              layout: {
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                padding: insets(4, 6),
              },
              corners: corners(6),
            }}
          >
            <UiIcon name={paused ? 'play' : 'pause'} size={14} />
          </Pressable>
        )}
        {!readOnly && onSwitchToLogs && (
          <Pressable
            id="console-switch-to-logs"
            ariaLabel="Open Live logs"
            onActivate={onSwitchToLogs}
            style={{
              layout: {
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                padding: insets(4, 6),
              },
              corners: corners(6),
            }}
          >
            <UiIcon name="file-text" size={14} />
          </Pressable>
        )}
        <Pressable
          id="console-copy"
          ariaLabel="Copy terminal output"
          onActivate={onCopy}
          style={{
            layout: {
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              padding: insets(4, 6),
            },
            corners: corners(6),
          }}
        >
          <UiIcon name={copied ? 'check' : 'copy'} size={14} />
        </Pressable>
        <Pressable
          id="console-clear"
          ariaLabel="Clear output"
          onActivate={onClear}
          style={{
            layout: {
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              padding: insets(4, 6),
            },
            corners: corners(6),
          }}
        >
          <UiIcon name="trash-2" size={14} />
        </Pressable>
        <Pressable
          id="console-reconnect"
          ariaLabel="Reconnect"
          onActivate={onReconnect}
          style={{
            layout: {
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              padding: insets(4, 6),
            },
            corners: corners(6),
          }}
        >
          <UiIcon name="rotate-cw" size={14} />
        </Pressable>
        <Pressable
          id="console-search-toggle"
          ariaLabel="Find in output"
          onActivate={onToggleSearch}
          style={{
            layout: {
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              padding: insets(4, 6),
            },
            corners: corners(6),
          }}
        >
          <UiIcon name="search" size={14} />
        </Pressable>
      </Row>
    </Row>
  );
}
