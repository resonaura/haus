/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { TerminalRuntimeScope, TerminalTarget } from '@haus/core/protocol';

export interface TerminalAccessCredentials {
  readonly url: string;
  readonly token: string;
}

/** Injectable pin store for Hub Ed25519 identity fingerprints per `(homeId, targetHubId)`. */
export interface TerminalKeyStorePort {
  getPinned(homeId: string, targetHubId: string): Promise<string | undefined>;
  pin(homeId: string, targetHubId: string, fingerprintHex: string): Promise<void>;
}

export interface HausTerminalOpenRequest {
  readonly sessionId: string;
  readonly serverId: string;
  readonly target?: TerminalTarget;
  readonly cols: number;
  readonly rows: number;
  readonly trustFingerprint?: string;
}

export type HausTerminalEvent =
  | { sessionId: string; type: 'data'; data: Uint8Array; bytes: number }
  | {
      sessionId: string;
      type: 'status';
      state: 'connecting' | 'connected' | 'disconnected';
      message?: string;
      transport: 'hub';
      scope?: TerminalRuntimeScope;
      hostname?: string;
      shell?: string;
      relayed?: boolean;
      readOnly?: boolean;
    }
  | { sessionId: string; type: 'host-key'; fingerprint: string; changed: boolean }
  | { sessionId: string; type: 'exit'; code: number | null };

export function terminalErrorMessage(code: string): string {
  switch (code) {
    case 'admin_required':
      return 'Hub terminal access requires an administrator session.';
    case 'terminal_disabled':
      return 'Interactive terminal access is disabled on this Hub.';
    case 'terminal_rate_limited':
    case 'terminal_session_limit':
      return 'Too many active terminal sessions on this Hub. Close another terminal and try again.';
    case 'target_peer_untrusted':
      return 'This peer Hub is not trusted by the cluster.';
    case 'target_server_not_found':
      return 'Could not reach the target Hub in the cluster.';
    case 'peer_identity_mismatch':
      return 'The peer Hub identity could not be verified.';
    case 'terminal_shell_unavailable':
    case 'terminal_platform_unsupported':
      return 'Interactive shell is not available on this Hub host.';
    case 'container_not_found':
      return 'This Docker container was not found on the Hub.';
    case 'container_not_running':
      return 'Start this Docker container before opening an interactive terminal.';
    case 'docker_unavailable':
      return 'Docker is not accessible from this Hub.';
    case 'docker_exec_create_failed':
    case 'docker_exec_start_failed':
      return 'Could not start a shell inside this Docker container.';
    case 'service_logs_unavailable':
      return 'Host systemd/PM2 logs require running Haus on the host with journalctl/PM2 access.';
    case 'app_not_found':
      return 'This App was not found on the Hub.';
    case 'app_terminal_requires_container':
      return 'Interactive terminal is only available for container-backed Apps.';
    default:
      return 'Could not open the secure Hub terminal connection.';
  }
}
