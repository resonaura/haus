/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { WebSocket } from 'ws';

export interface LivePublishOptions {
  readonly stateChanges?: Record<string, Record<string, unknown>>;
  readonly registryChanged?: boolean;
}

export interface LiveState {
  protocol: number;
  instance: string;
  sequence: number;
  topic: string;
  revision: string;
  connected: boolean;
  sources?: unknown[];
  stateChanges?: Record<string, Record<string, unknown>>;
  registryChanged?: boolean;
}

export interface LiveService {
  publish(topic: string, options?: LivePublishOptions): void;
  getState(topic?: string, options?: LivePublishOptions): LiveState;
  setConnected(connected: boolean): void;
  setRevision(revision: string): void;
  setSourcesProvider(provider: () => unknown[]): void;
  authorize(header: string | undefined): boolean;
  addClient(socket: WebSocket): void;
  removeClient(socket: WebSocket): void;
  getClientCount(): number;
}
