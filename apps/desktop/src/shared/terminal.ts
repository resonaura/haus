/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { TerminalTarget } from '@haus/core/protocol';
export type { TerminalTarget };

export interface ServerSshProfile {
  serverId: string;
  host: string;
  port: number;
  username: string;
  environment: 'native' | 'wsl';
  auth: 'password' | 'agent';
  hasPassword: boolean;
}
export interface ServerSshServer extends ServerSshProfile {
  online: boolean | null;
}
export interface ServerSshHubTarget {
  id: string;
  host?: string;
  hostname?: string;
  local?: boolean;
}
export interface ServerSshInput extends Omit<ServerSshProfile, 'hasPassword'> {
  password?: string;
  rememberPassword?: boolean;
}
export type ServerTerminalTransport = 'hub' | 'ssh';
export type ServerTerminalEvent =
  | { sessionId: string; type: 'data'; data: string | Uint8Array; bytes: number }
  | {
      sessionId: string;
      type: 'status';
      state: 'connecting' | 'connected' | 'disconnected';
      message?: string;
      transport?: ServerTerminalTransport;
      scope?: 'container' | 'host';
      hostname?: string;
      shell?: string;
      relayed?: boolean;
      readOnly?: boolean;
    }
  | { sessionId: string; type: 'host-key'; fingerprint: string; changed: boolean }
  | { sessionId: string; type: 'exit'; code: number | null };

export interface ServerSshTerminalOpen {
  mode?: 'ssh';
  sessionId: string;
  profile: ServerSshInput;
  cols: number;
  rows: number;
  trustFingerprint?: string;
}

export interface ServerHubTerminalOpen {
  mode: 'hub';
  sessionId: string;
  serverId: string;
  target?: TerminalTarget;
  cols: number;
  rows: number;
  trustFingerprint?: string;
}

export type ServerTerminalOpen = ServerSshTerminalOpen | ServerHubTerminalOpen;
