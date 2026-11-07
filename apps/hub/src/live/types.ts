/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { WebSocket } from 'ws';

export interface LiveState {
  protocol: number;
  instance: string;
  sequence: number;
  topic: string;
  revision: string;
  connected: boolean;
  sources?: unknown[];
}

export interface LiveService {
  publish(topic: string): void;
  getState(topic?: string): LiveState;
  setConnected(connected: boolean): void;
  setRevision(revision: string): void;
  setSourcesProvider(provider: () => unknown[]): void;
  authorize(header: string | undefined): boolean;
  addClient(socket: WebSocket): void;
  removeClient(socket: WebSocket): void;
  getClientCount(): number;
}
