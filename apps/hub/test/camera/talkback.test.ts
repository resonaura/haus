/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { describe, it } from 'vitest';
import {
  createTalkback,
  customTalkback,
  talkbackAddress,
  talkbackTarget,
  type TalkbackCamera,
} from '../../src/camera/index.js';

describe('talkback', () => {
  it('native Talkback keeps working without an HA sensor and never falls back to an unrelated old source', () => {
    const camera: TalkbackCamera = {
      id: 'camera.one',
      nativeProvider: { bridgeId: 'b' },
      nativeTalkback: 'rtmp://192.168.1.20:1935/talk/one',
    };
    assert.equal(talkbackTarget(camera, { states: [] }), camera.nativeTalkback);
    delete camera.nativeTalkback;
    assert.equal(
      talkbackTarget(camera, {
        states: [
          {
            entity_id: 'sensor.one_talkback_rtmp_stream',
            state: 'rtmp://192.168.1.99/talk/old',
          },
        ],
      }),
      null,
    );
  });

  it('talkback uses an explicit sensor and never guesses from RTSP', () => {
    const camera = { id: 'camera.garden', aliases: ['camera.garden_internal'] };
    assert.equal(
      talkbackTarget(camera, {
        states: [
          {
            entity_id: 'sensor.garden_rtsp_stream',
            state: 'rtsp://192.168.1.20/live',
          },
        ],
      }),
      null,
    );
    assert.equal(
      talkbackTarget(camera, {
        states: [
          {
            entity_id: 'sensor.garden_talkback_rtmp_stream',
            state: 'rtmp://192.168.1.20:1935/talk/garden',
          },
        ],
      }),
      'rtmp://192.168.1.20:1935/talk/garden',
    );
    assert.equal(
      talkbackTarget(camera, {
        states: [
          {
            entity_id: 'sensor.garden_talkback_rtmp_stream',
            state: 'rtmp://example.com/talk/garden',
          },
        ],
      }),
      null,
    );
    assert.equal(
      talkbackTarget(camera, {
        states: [
          {
            entity_id: 'sensor.other_talkback_rtmp_stream',
            state: 'rtmp://192.168.1.20/talk/other',
          },
        ],
      }),
      null,
    );
  });

  it('transcodes the browser stream only to the discovered talk endpoint and releases it when the client leaves', async () => {
    let args: readonly string[] = [];
    let killed = false;
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, {
      stdin,
      stderr,
      exitCode: null as number | null,
      kill: () => {
        killed = true;
        child.exitCode = 0;
        emitter.emit('close', 0);
        return true;
      },
    });
    const chunks: Buffer[] = [];
    stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    const talk = createTalkback({
      spawnProcess: ((command: string, values: readonly string[]) => {
        assert.equal(command, 'ffmpeg');
        args = values;
        return child as unknown as ChildProcess;
      }) as typeof import('node:child_process').spawn,
    });
    const registry = {
      states: [
        {
          entity_id: 'sensor.test_talkback_rtmp_stream',
          state: 'rtmp://192.168.1.20:1935/talk/test',
        },
      ],
    };
    const server = createServer((req, res) => {
      void talk.stream({ id: 'camera.test' }, registry, req, res).catch(() => res.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'X-Haus-Client': '1', 'Content-Type': 'audio/webm;codecs=opus' },
        body: Buffer.from([26, 69, 223, 163]),
      });
      assert.equal(response.status, 200);
      assert.equal(args.at(-1), 'rtmp://192.168.1.20:1935/talk/test');
      assert.ok(args.includes('aac'));
      assert.ok(args.includes('16000'));
      await response.body?.cancel();
      talk.stopAll();
      assert.equal(killed, true);
      assert.deepEqual(Buffer.concat(chunks), Buffer.from([26, 69, 223, 163]));
    } finally {
      talk.stopAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // An external DNS name is not private merely because its labels resemble an IP prefix.
  it('rejects external DNS names disguised as private IPv4 addresses', () => {
    const camera = { id: 'camera.garden' };
    for (const host of [
      '127.example.com',
      '10.example.com',
      '192.168.example.com',
      '172.16.example.com',
    ]) {
      assert.equal(
        talkbackTarget(camera, {
          states: [
            {
              entity_id: 'sensor.garden_talkback_rtmp_stream',
              state: `rtmp://${host}/talk/garden`,
            },
          ],
        }),
        null,
      );
    }
    for (const host of [
      '10.1.2.3',
      '172.16.1.3',
      '192.168.1.20',
      'camera.local',
      'camera.lan',
    ]) {
      assert.equal(
        talkbackTarget(camera, {
          states: [
            {
              entity_id: 'sensor.garden_talkback_rtmp_stream',
              state: `rtmp://${host}/talk/garden`,
            },
          ],
        }),
        `rtmp://${host}/talk/garden`,
      );
    }
  });

  it('custom talk sources accept exact local targets or explicitly selected URL entities and fail closed after an entity changes', () => {
    const registry = {
      states: [
        {
          entity_id: 'sensor.voice',
          state: 'rtmp://192.168.1.25/custom/microphone',
        },
      ],
    };
    const source = customTalkback({ entityId: 'sensor.voice' }, registry);
    assert.equal(
      talkbackTarget({ id: 'camera.test', talkback: source }, registry),
      'rtmp://192.168.1.25/custom/microphone',
    );
    assert.equal(
      talkbackTarget(
        { id: 'camera.test', talkback: source },
        {
          states: [
            {
              entity_id: 'sensor.voice',
              state: 'rtmp://public.example/microphone',
            },
          ],
        },
      ),
      null,
    );
    assert.throws(() => customTalkback({ url: 'http://192.168.1.1/token' }, registry));
    assert.throws(() => customTalkback({ url: 'rtmp://192.168.1.1.evil/talk' }, registry));
    assert.throws(() => customTalkback({ entityId: 'sensor.unknown' }, registry));
    assert.throws(() =>
      customTalkback({ url: 'rtmp://192.168.1.1/talk', entityId: 'sensor.voice' }, registry),
    );
    assert.equal(talkbackAddress('rtmp://[fd00::1]/talk'), 'rtmp://[fd00::1]/talk');
    assert.equal(customTalkback(null, registry), null);
  });
});
