/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { RecordingProgress } from '../../src/recording/progress.js';

test('FFmpeg stream-copy timestamps prove progress even without a frame counter', () => {
  const progress = new RecordingProgress();
  assert.equal(progress.push('bitrate=N/A\nout_time_us=2600000\nprogress=continue\n'), true);
  assert.equal(progress.frames, 0);
  assert.equal(progress.timeUs, 2600000);
  assert.equal(progress.sustained, false);
  assert.equal(progress.push('out_time_us=6800000\nprogress=continue\n'), true);
  assert.equal(progress.sustained, true);
});

test('split frame counters work while repeated, backwards or invalid output cannot hide a stall', () => {
  const progress = new RecordingProgress();
  assert.equal(progress.push('fra'), false);
  assert.equal(progress.push('me=  120\nout_time_us=6000000\n'), true);
  assert.equal(progress.frames, 120);
  assert.equal(progress.sustained, true);
  assert.equal(progress.push('frame=120\nout_time_us=6000000\n'), false);
  assert.equal(progress.push('frame=2\nout_time_us=1000000\n'), false);
  assert.equal(progress.push('frame=N/A\nout_time_us=-1\nframe=9007199254740999\n'), false);
  assert.equal(progress.push('frame=121\n'), true);
});

test('startup zeroes do not prove media and a new process gets fresh bounded progress', () => {
  const progress = new RecordingProgress();
  assert.equal(progress.push('frame=0\nout_time_us=0\nprogress=continue\n'), false);
  assert.equal(progress.push('x'.repeat(20000)), false);
  assert.ok(progress.bufferedCharacters <= 8192);
  assert.equal(progress.push('\nout_time_us=1\n'), true);
  assert.equal(new RecordingProgress().timeUs, 0);
});

test('accepts split Buffer chunks while keeping unfinished process output private', () => {
  const progress = new RecordingProgress();
  assert.equal(progress.push(Buffer.from('fra')), false);
  assert.equal(progress.push(Buffer.from('me=121\n')), true);
  assert.equal(progress.frames, 121);
  assert.equal(progress.sustained, true);
  const privateOutput = 'private-process-output-fixture';
  assert.equal(progress.push(Buffer.from(privateOutput)), false);
  assert.equal(progress.bufferedCharacters, privateOutput.length);
  assert.ok(!JSON.stringify(progress).includes(privateOutput));
});

test('complete progress survives a large chunk and matches split delivery', () => {
  const output = 'frame=121\n' + 'x'.repeat(20000) + '\nout_time_us=7000000\n';
  const whole = new RecordingProgress();
  const split = new RecordingProgress();
  assert.equal(whole.push(output), true);
  assert.equal(split.push('frame=121\n'), true);
  assert.equal(split.push('x'.repeat(20000)), false);
  assert.ok(split.bufferedCharacters <= 8192);
  assert.equal(split.push('\nout_time_us=7000000\n'), true);
  assert.equal(whole.frames, 121);
  assert.equal(whole.timeUs, 7000000);
  assert.equal(whole.frames, split.frames);
  assert.equal(whole.timeUs, split.timeUs);
});

test('an oversized malformed line cannot turn its retained suffix into progress', () => {
  const suffix = 'frame=120' + ' '.repeat(8182) + '\n';
  const output = 'invalid-prefix' + suffix;
  for (const splitAt of [0, 14, 8192, 8193]) {
    const progress = new RecordingProgress();
    assert.equal(progress.push(output.slice(0, splitAt)), false);
    assert.equal(progress.push(output.slice(splitAt)), false);
    assert.ok(progress.bufferedCharacters <= 8192);
    assert.equal(progress.frames, 0);
    assert.equal(progress.sustained, false);
    assert.equal(progress.push('out_time_us=1\n'), true);
    assert.equal(progress.timeUs, 1);
  }
});
