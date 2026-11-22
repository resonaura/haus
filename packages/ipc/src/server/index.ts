/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export {
  normalizeCrlfBytes,
  openDockerAnsiLogs,
  openDockerExecPty,
  resolveDockerSocketPath,
} from './docker-stream.js';
export {
  buildSanitizedTerminalEnv,
  detectTerminalScope,
  HubPtyProcess,
  type HubPtyCallbacks,
} from './pty.js';
export { openRawTerminalRelay, type RawTerminalRelayHandle } from './relay.js';
export { startLocalTerminalSession, type ActiveLocalTerminalSession } from './session.js';
export {
  openTerminalSource,
  type TerminalAppRuntimeInfo,
  type TerminalAppRuntimeResolver,
  type TerminalSourceCallbacks,
  type TerminalStreamSource,
} from './sources.js';
export {
  TerminalRateLimitError,
  TerminalTicketStore,
  type PendingLocalTicket,
  type PendingRelayTicket,
  type PendingTerminalTicket,
} from './tickets.js';
