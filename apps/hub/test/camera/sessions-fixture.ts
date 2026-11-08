/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CameraCatalog, openCatalog, Transactions } from '@haus/hub/storage';
import { RecordingStore, runMedia } from '@haus/hub/events';
import {
  NvrCameraSessions,
  type SessionCamera,
  type SessionEntry,
  type SessionNode,
  type SessionNodeHealth,
} from '../../src/camera/index.js';

export const owner = 'test-owner-000000000000';

export const camera: SessionCamera = {
  id: 'camera.garden',
  enabled: true,
  available: true,
  sensors: [],
  playbackSource: { platform: 'mqtt', manufacturer: 'Aqara' },
};

export const state = (value: string) => ({
  entity_id: 'sensor.garden_p2p_rtsp_stream',
  state: value,
});

export const session: Omit<
  SessionEntry,
  'node' | 'cameraId' | 'owner' | 'fingerprint' | 'renewedAt' | 'until'
> = {
  id: randomUUID(),
  state: 'ready',
  audio: true,
  capabilities: { webrtc: true, recording: true },
};

export interface SessionTestCall {
  node?: string;
  path: string;
  method?: string;
  data?: Record<string, unknown>;
}

export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function createSessionsFixture(
  overrides: Partial<ConstructorParameters<typeof NvrCameraSessions>[0]> = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'haus-camera-nvr-'));
  const media = join(root, 'media');
  await mkdir(media);
  const database = join(root, 'db.sqlite');
  const source = await openCatalog(database);
  const transactions = new Transactions(source);
  const store = new RecordingStore(source, media, transactions);
  const cameraCatalog = new CameraCatalog(transactions);
  await cameraCatalog.initialize();
  const config = {
    data: root,
    media,
    recording_enabled: true,
    pre_roll_seconds: 8,
    post_roll_seconds: 12,
    max_event_seconds: 180,
    retention_days: 14,
    max_storage_gb: 20,
    max_buffer_gb: 2,
    record_audio: true,
  };
  const registry: {
    cameras: SessionCamera[];
    states: { entity_id: string; state: string }[];
    entities: { entity_id: string; device_id?: string; disabled_by?: string }[];
  } = {
    cameras: [structuredClone(camera)],
    states: [state('rtsp://user:private@192.168.4.44:8556/live')],
    entities: [],
  };
  const nodes: SessionNode[] = [
    {
      id: 'a',
      key: 'k'.repeat(32),
      url: 'http://192.168.5.117:8788',
      enabled: true,
      roles: ['stream'],
      allowHttp: true,
    },
    {
      id: 'b',
      key: 'k'.repeat(32),
      url: 'http://192.168.5.115:8788',
      enabled: true,
      roles: ['stream'],
      allowHttp: true,
    },
  ];
  const cluster = {
    nodes: () => nodes,
    health: new Map<string, SessionNodeHealth>(
      nodes.map((node, i) => [
        node.id,
        {
          online: true,
          remote: {
            rtspSessions: {
              profile: 1,
              active: i ? 0 : 2,
              max: 4,
              webrtc: true,
              recording: true,
            },
            resources: { pressured: false },
          },
        },
      ]),
    ),
  };
  const calls: SessionTestCall[] = [];
  const json: ConstructorParameters<typeof NvrCameraSessions>[0]['json'] = async (
    node,
    path,
    options,
  ) => {
    const nodeWithId = node as { id?: string };
    calls.push({
      node: nodeWithId.id,
      path,
      method: options?.method,
      data: options?.data as Record<string, unknown> | undefined,
    });
    return session;
  };
  const request: ConstructorParameters<typeof NvrCameraSessions>[0]['request'] = async (
    node,
    path,
    options,
  ) => {
    const nodeWithId = node as { id?: string };
    calls.push({
      node: nodeWithId.id,
      path,
      method: options?.method,
      data: options?.data as Record<string, unknown> | undefined,
    });
    return new Response('{}');
  };
  const sessions = new NvrCameraSessions({
    config,
    store,
    catalog: cameraCatalog,
    cluster,
    registry: () => registry,
    json,
    request,
    ...overrides,
  });
  return {
    root,
    media,
    store,
    source,
    config,
    registry,
    nodes,
    cluster,
    calls,
    sessions,
    cleanup: async () => {
      await sessions.stop();
      await transactions.drain();
      await store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function createTestClip(prefix = 'haus-nvr-clip-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const file = join(root, 'clip.mp4');
  await runMedia('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=160x90:r=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=16000',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-threads',
    '1',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    file,
  ]);
  const data = await readFile(file);
  const sha256 = createHash('sha256').update(data).digest('hex');
  return {
    data,
    sha256,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
