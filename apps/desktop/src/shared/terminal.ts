/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

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
export interface ServerSshInput extends Omit<ServerSshProfile, 'hasPassword'> {
  password?: string;
  rememberPassword?: boolean;
}
export type ServerTerminalEvent =
  | { sessionId: string; type: 'data'; data: string; bytes: number }
  | {
      sessionId: string;
      type: 'status';
      state: 'connecting' | 'connected' | 'disconnected';
      message?: string;
    }
  | { sessionId: string; type: 'host-key'; fingerprint: string; changed: boolean }
  | { sessionId: string; type: 'exit'; code: number | null };
export interface ServerTerminalOpen {
  sessionId: string;
  profile: ServerSshInput;
  cols: number;
  rows: number;
  trustFingerprint?: string;
}
