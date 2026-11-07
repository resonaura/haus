/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { ChildProcess, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { VisionWorker, type DetectionEvent } from '../src/index.js';

function processFixture() {
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const kill = vi.spyOn(child, 'kill').mockImplementation(() => {
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  });
  return { child, kill };
}

it('keeps one inference frame in flight, drops stale frames and waits for calibrated results', async () => {
  const children: ReturnType<typeof processFixture>[] = [];
  const frames: Buffer[] = [],
    detections: DetectionEvent[] = [];
  const processPort = { spawn };
  vi.spyOn(processPort, 'spawn').mockImplementation(() => {
    const fixture = processFixture();
    children.push(fixture);
    return fixture.child;
  });
  const worker = new VisionWorker({
    source: 'http://fixture.test/index.m3u8',
    interval: 0,
    onDetection: (event) => detections.push(event),
    spawnProcess: processPort.spawn,
  });
  const inference = children[0].child,
    decoder = children[1].child;
  try {
    inference.stdin.on('data', (frame: Buffer) => frames.push(frame));
    inference.stdout.write('{"type":"ready"}\n');
    for (let index = 0; index < 100; index++)
      decoder.stdout.emit('data', Buffer.alloc(320 * 180 * 3, index));
    expect(frames).toHaveLength(1);
    expect(frames[0][0]).toBe(0);
    expect(frames[0].at(-1)).toBe(0);
    inference.stdout.write(
      '{"type":"frame","calibrated":false,"processingMs":0,"detections":[{"kind":"person"}]}\n',
    );
    decoder.stdout.emit('data', Buffer.alloc(320 * 180 * 3, 123));
    expect(frames).toHaveLength(2);
    expect(frames[1][0]).toBe(123);
    expect(detections).toHaveLength(0);
    expect(worker.calibrated).toBe(false);
    inference.stdout.write(
      '{"type":"frame","calibrated":true,"processingMs":0,"detections":[{"kind":"person"}]}\n',
    );
    expect(detections).toHaveLength(1);
    expect(worker.calibrated).toBe(true);
    expect(worker.state).toBe('running');
  } finally {
    await worker.stop();
  }
  for (const fixture of children) expect(fixture.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
});
