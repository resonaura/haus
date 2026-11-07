/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import type { NativeCameraSession, NativeCameraViewer } from '../../../src/stream/native-types.js';

export function sessionFixture(
  id: string,
  fields: Partial<NativeCameraSession> = {},
): NativeCameraSession {
  return {
    id,
    cameraId: 'camera.fixture',
    sourceKind: 'rtsp',
    source: 'rtsp://127.0.0.1/fixture',
    startedAt: Date.now(),
    rtspPort: 0,
    videoPort: 0,
    audioPort: 0,
    viewers: new Set(),
    stopped: false,
    restarts: 0,
    mediaReadyAt: 0,
    readyPromise: Promise.resolve(),
    ...fields,
  };
}
export function viewerFixture(
  session: NativeCameraSession,
  ports: Pick<NativeCameraViewer, 'videoPort' | 'audioPort'>,
): NativeCameraViewer {
  return {
    id: randomUUID(),
    session,
    owner: 'fixture-owner-123456789',
    startedAt: Date.now(),
    ...ports,
    closed: false,
    connected: false,
    signaled: false,
    restarts: 0,
  };
}
