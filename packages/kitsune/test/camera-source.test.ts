/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  CameraSourceDiagnostics,
  cameraSourceDiagnostic,
  cameraSourceFailure,
} from '../dist/camera.js';

test('camera source diagnostics bound errors and hide source and device identifiers', () => {
  const source = 'rtsp://user:password@camera.local/main';
  const failure = cameraSourceFailure('source-validation', new Error(`${source} invalid`));
  assert.deepEqual(failure, {
    stage: 'source-validation',
    reason: 'source_validation_failed',
  });
  const diagnostic = cameraSourceDiagnostic(
    '@fixture/camera',
    'serial-with-private-data',
    'camera_source_unavailable',
    failure,
  );
  assert.equal(diagnostic.event, 'camera_source_unavailable');
  assert.equal(diagnostic.message, 'stage=source-validation; reason=source_validation_failed');
  assert.match(diagnostic.target ?? '', /^camera-[a-f0-9]{24}$/);
  assert.ok(!JSON.stringify(diagnostic).includes(source));
  assert.ok(!JSON.stringify(diagnostic).includes('serial-with-private-data'));
});

test('camera source diagnostics preserve only explicitly allowed failure codes', () => {
  assert.deepEqual(
    cameraSourceFailure('media-input', new Error('kitsune_media_adapter_required')),
    { stage: 'media-input', reason: 'kitsune_media_adapter_required' },
  );
  assert.deepEqual(cameraSourceFailure('stream-selection', 'arbitrary'), {
    stage: 'stream-selection',
    reason: 'stream_selection_failed',
  });
  assert.equal(
    cameraSourceDiagnostic('fixture', 'front', 'camera_source_restored').message,
    'source validated',
  );
});

test('camera source diagnostics deduplicate failures and report recovery once', () => {
  const diagnostics: ReturnType<typeof cameraSourceDiagnostic>[] = [];
  const tracker = new CameraSourceDiagnostics((event) => diagnostics.push(event));
  tracker.failed('fixture', 'front', 'media-input', new Error('camera is unreachable'));
  tracker.failed('fixture', 'front', 'media-input', new Error('another private error'));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.message, 'stage=media-input; reason=media_input_failed');

  tracker.failed('fixture', 'front', 'source-validation', new Error('invalid source'));
  assert.equal(diagnostics.length, 2);
  tracker.restored('fixture', 'front');
  tracker.restored('fixture', 'front');
  assert.equal(diagnostics.length, 3);
  assert.equal(diagnostics.at(-1)?.event, 'camera_source_restored');

  tracker.failed('fixture', 'front', 'media-input', new Error('offline'));
  tracker.forget('fixture', 'front');
  tracker.restored('fixture', 'front');
  assert.equal(diagnostics.length, 4);
});
