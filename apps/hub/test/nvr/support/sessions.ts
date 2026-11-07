/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'vitest';
import { CameraSessions, type CameraSessionsEngine, type CameraSessionsRing } from '../../../src/nvr/camera/sessions.js';
import { engineFixture, ringFixture } from './camera.js';
export const owner = 'fixture-owner-123456789', other = 'second-owner-123456789';
export const input = (extra: Record<string, unknown> = {}) => ({ cameraId: 'camera.fixture', owner, advertiseHost: '192.168.1.5',
  source: { kind: 'p2p-restream', url: 'rtsp://name:private-password@192.168.1.9:8555/stream' }, ...extra });
export async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'haus-camera-sessions-'));
  let at = 100000;
  const added: Parameters<CameraSessionsEngine['add']>[] = [], removed: string[] = [], rings: CameraSessionsRing[] = [];
  const engine = engineFixture({ add: async (...args) => { added.push(args); }, remove: async id => { removed.push(id); },
    offer: async (session, owner) => { const viewerId = randomUUID(); engine.viewers.set(viewerId,{session:{id:session},owner});
      return { viewerId, answer: { type: 'answer', sdp: 'v=0\r\n' }, candidates: [] }; },
  });
  const sessions = await new CameraSessions(root, engine, { max: 2, now: () => at,
    ring: () => { const ring = ringFixture(at); rings.push(ring); return ring; },
  }).initialize();
  t.onTestFinished(async () => { await sessions.stop(); await rm(root,{recursive:true,force:true}); });
  return { root, sessions, engine, added, removed, rings, advance: (ms: number) => { at += ms; } };
}
