/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { listen, port, closeServer } from '../support/http.js';
import { test, onTestFinished } from 'vitest';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import {
  ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type spawn,
} from 'node:child_process';
import { createEufyTalkback, eufySerial, type EufyDeviceRegistry } from '@haus/kitsune/native';
const serial = 'T1234567890123456',
  camera = { id: 'camera.eufy', deviceId: 'device' },
  registry: EufyDeviceRegistry = {
    devices: [{ id: 'device', identifiers: [['eufy_security', serial] as const] }],
  };
test('Eufy identity comes from the same registered device, never a room/name guess', () => {
  assert.equal(eufySerial(camera, registry), serial);
  assert.equal(eufySerial({ id: 'camera.eufy' }, registry), null);
  assert.equal(
    eufySerial(
      { ...camera, deviceIds: ['device', 'other'] },
      {
        devices: [
          ...(registry.devices ?? []),
          {
            id: 'other',
            identifiers: [['eufy_security', 'T9999999999999999'] as const],
          },
        ],
      },
    ),
    null,
  );
});
for (const alreadyLive of [false, true])
  test(`Eufy waits for confirmed talkback and ${alreadyLive ? 'preserves an existing' : 'cleans up its own'} livestream`, async () => {
    const messages: Array<{ command: string; messageId: string }> = [];
    const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => ws.once('listening', () => r()));
    ws.on('connection', (socket) => {
      socket.send(
        JSON.stringify({
          type: 'version',
          minSchemaVersion: 13,
          maxSchemaVersion: 21,
        }),
      );
      socket.on('message', (raw) => {
        const input = JSON.parse(String(raw)) as { command: string; messageId: string };
        messages.push(input);
        const result =
          input.command === 'device.has_command'
            ? { exists: true }
            : input.command === 'device.is_livestreaming'
              ? { livestreaming: alreadyLive }
              : input.command === 'device.is_talkback_ongoing'
                ? { talkbackOngoing: false }
                : {};
        socket.send(
          JSON.stringify({
            type: 'result',
            messageId: input.messageId,
            success: true,
            result,
          }),
        );
        if (['device.start_livestream', 'device.start_talkback'].includes(input.command))
          setTimeout(
            () =>
              socket.send(
                JSON.stringify({
                  type: 'event',
                  event: {
                    serialNumber: serial,
                    event:
                      input.command === 'device.start_livestream'
                        ? 'livestream started'
                        : 'talkback started',
                  },
                }),
              ),
            5,
          );
      });
    });
    let args: readonly string[] = [];
    const spawnProcess = ((_command: string, values?: readonly string[] | SpawnOptions) => {
      if (Array.isArray(values)) args = values;
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new ChildProcess(), {
        stdin,
        stdout,
        stderr,
        exitCode: null as number | null,
        kill: () => {
          child.exitCode = 0;
          return true;
        },
      });
      stdin.resume();
      stdin.on('finish', () => stdout.end(Buffer.from([255, 241, 1, 2])));
      return child as ChildProcessWithoutNullStreams;
    }) as typeof spawn;
    const talk = createEufyTalkback(
      { eufy_ws_url: `ws://127.0.0.1:${port(ws)}` },
      { spawnProcess },
    );
    const http = createServer(
      (req, res) => void talk.stream(camera, registry, req, res).catch(() => res.destroy()),
    );
    await listen(http);
    onTestFinished(async () => {
      talk.stopAll();
      http.closeAllConnections();
      await closeServer(http);
      for (const client of ws.clients) client.terminate();
      await closeServer(ws);
    });
    const response = await fetch(`http://127.0.0.1:${port(http)}`, {
      method: 'POST',
      body: Buffer.from('synthetic-input'),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    const commands = messages.map((m) => m.command);
    assert.ok(commands.includes('device.start_talkback'));
    assert.ok(commands.includes('device.stop_talkback'));
    assert.equal(commands.includes('device.start_livestream'), !alreadyLive);
    assert.equal(commands.includes('device.stop_livestream'), !alreadyLive);
    assert.ok(
      commands.indexOf('device.talkback_audio_data') > commands.indexOf('device.start_talkback'),
    );
    assert.ok(args.includes('adts'));
    assert.ok(args.includes('16000'));
  });
