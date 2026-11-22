/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
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
    <div className="server-terminal-host-key">
      <ShieldCheck size={22} />
      <div>
        <strong>
          {transportMode === 'hub'
            ? hostKey.changed
              ? 'The Hub’s identity key changed'
              : 'Verify this Hub'
            : hostKey.changed
              ? 'The server’s SSH key changed'
              : 'Verify this server'}
        </strong>
        <p>{hostKey.fingerprint}</p>
      </div>
      <Button variant="secondary" onPress={onTrust}>
        Trust and connect
      </Button>
    </div>
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
    <footer className="server-terminal-footer">
      {transportMode === 'hub' ? (
        <span className="server-terminal-transport-badge">
          <ShieldCheck size={13} />
          {hubStatusLabel}
        </span>
      ) : (
        <span>{sshConfigured ? `${sshUsername}@${sshHost}` : 'Connect over SSH'}</span>
      )}
      <div>
        <span>{geometry.cols > 0 ? `${geometry.cols} × ${geometry.rows}` : ''}</span>
        {supportsHubIpc && (
          <button
            type="button"
            className="server-terminal-mode-toggle"
            title={
              transportMode === 'hub'
                ? 'Switch to host SSH terminal'
                : 'Switch to Haus Secure IPC terminal'
            }
            onClick={() => onSwitchTransport(transportMode === 'hub' ? 'ssh' : 'hub')}
          >
            {transportMode === 'hub' ? 'SSH' : 'Haus IPC'}
          </button>
        )}
        {transportMode === 'ssh' && (
          <button
            type="button"
            aria-label="SSH settings"
            title="SSH settings"
            aria-pressed={editingSsh}
            onClick={onToggleSshSettings}
          >
            <Settings2 size={14} />
          </button>
        )}
        <button type="button" aria-label="Find in terminal" onClick={onOpenSearch}>
          <Search size={14} />
        </button>
      </div>
    </footer>
  );
}
