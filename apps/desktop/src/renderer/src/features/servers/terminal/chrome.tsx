/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausButton, Pressable, Text } from '@haus/ui';
import { Search, Settings2, ShieldCheck } from 'lucide-react';
import type { ServerTerminalTransport } from '../../../../../shared/terminal';

export interface HubTerminalMeta {
  readonly scope?: 'container' | 'host';
  readonly hostname?: string;
  readonly shell?: string;
  readonly relayed?: boolean;
}

export function TerminalHostKeyBanner({
  transportMode,
  hostKey,
  onTrust,
}: {
  readonly transportMode: ServerTerminalTransport;
  readonly hostKey: { readonly fingerprint: string; readonly changed: boolean };
  readonly onTrust: () => void;
}) {
  return (
    <Box className="server-terminal-host-key">
      <ShieldCheck size={22} />
      <Box>
        <Text semantic="strong">
          {transportMode === 'hub'
            ? hostKey.changed
              ? 'The Hub’s identity key changed'
              : 'Verify this Hub'
            : hostKey.changed
              ? 'The server’s SSH key changed'
              : 'Verify this server'}
        </Text>
        <Text semantic="p">{hostKey.fingerprint}</Text>
      </Box>
      <HausButton variant="secondary" onPress={onTrust}>
        Trust and connect
      </HausButton>
    </Box>
  );
}

export function TerminalFooter({
  transportMode,
  supportsHubIpc,
  connecting,
  hubMeta,
  sshConfigured,
  sshUsername,
  sshHost,
  geometry,
  editingSsh,
  onSwitchTransport,
  onToggleSshSettings,
  onOpenSearch,
}: {
  readonly transportMode: ServerTerminalTransport;
  readonly supportsHubIpc: boolean;
  readonly connecting: boolean;
  readonly hubMeta?: HubTerminalMeta;
  readonly sshConfigured: boolean;
  readonly sshUsername: string;
  readonly sshHost: string;
  readonly geometry: { readonly cols: number; readonly rows: number };
  readonly editingSsh: boolean;
  readonly onSwitchTransport: (next: ServerTerminalTransport) => void;
  readonly onToggleSshSettings: () => void;
  readonly onOpenSearch: () => void;
}) {
  const hubStatusLabel = connecting
    ? 'Connecting via Haus Direct IPC · E2EE…'
    : [
        'Haus Direct IPC · E2EE',
        hubMeta?.relayed ? 'Relayed' : null,
        hubMeta?.scope === 'container' ? 'Container' : null,
        hubMeta?.hostname ?? null,
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <Box semantic="footer" className="server-terminal-footer">
      {transportMode === 'hub' ? (
        <Text className="server-terminal-transport-badge">
          <ShieldCheck size={13} />
          {hubStatusLabel}
        </Text>
      ) : (
        <Text>{sshConfigured ? `${sshUsername}@${sshHost}` : 'Connect over SSH'}</Text>
      )}
      <Box>
        <Text>{geometry.cols > 0 ? `${geometry.cols} × ${geometry.rows}` : ''}</Text>
        {supportsHubIpc && (
          <Pressable
            className="server-terminal-mode-toggle"
            title={
              transportMode === 'hub'
                ? 'Switch to host SSH terminal'
                : 'Switch to Haus Secure IPC terminal'
            }
            onPress={() => onSwitchTransport(transportMode === 'hub' ? 'ssh' : 'hub')}
          >
            {transportMode === 'hub' ? 'SSH' : 'Haus IPC'}
          </Pressable>
        )}
        {transportMode === 'ssh' && (
          <Pressable
            ariaLabel="SSH settings"
            title="SSH settings"
            ariaPressed={editingSsh}
            onPress={onToggleSshSettings}
          >
            <Settings2 size={14} />
          </Pressable>
        )}
        <Pressable ariaLabel="Find in terminal" onPress={onOpenSearch}>
          <Search size={14} />
        </Pressable>
      </Box>
    </Box>
  );
}
