/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ChildProcess } from 'node:child_process';

export interface NativeCameraSession {
  id: string;
  cameraId: string;
  sourceKind: string;
  source: string;
  startedAt: number;
  rtspPort: number;
  videoPort: number;
  audioPort: number;
  viewers: Set<string>;
  stopped: boolean;
  restarts: number;
  mediaReadyAt: number;
  producerStartedAt?: number;
  producer?: ChildProcess;
  restartTimer?: NodeJS.Timeout;
  readyPromise: Promise<void>;
  readyResolve?: () => void;
}

export interface NativeCameraViewer {
  id: string;
  session: NativeCameraSession;
  owner: string;
  startedAt: number;
  videoPort: number;
  audioPort: number;
  closed: boolean;
  connected: boolean;
  signaled: boolean;
  restarts: number;
  process?: ChildProcess;
  restartTimer?: NodeJS.Timeout;
  connectTimer?: NodeJS.Timeout;
  starting?: Promise<void>;
}

export interface NativeMediaEvent {
  event: string;
  [key: string]: unknown;
}

export interface NativeWaiter {
  resolve: (value: NativeMediaEvent) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface NativeMediaLog {
  (event: string, fields: Record<string, unknown>): void;
}
