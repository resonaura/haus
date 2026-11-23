/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { createHausLogger } from '@haus/core';
import { isIpcErrorEnvelope, packIpcError, unpackIpcResult } from '../../shared/ipc-envelope';
import { classifyIpcError, logIpcError } from './logger';

describe('Desktop IPC error envelope and unified logger', () => {
  it('round-trips Error message, name, and custom code through the IPC envelope', () => {
    const original = Object.assign(new Error('camera not found'), {
      name: 'HelperOperationError',
      code: 'camera_not_found',
    });
    const packed = packIpcError(original);
    expect(isIpcErrorEnvelope(packed)).toBe(true);
    expect(packed.message).toBe('camera not found');
    expect(packed.code).toBe('camera_not_found');

    let caught: unknown;
    try {
      unpackIpcResult(packed);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('camera not found');
    expect((caught as Error).name).toBe('HelperOperationError');
    expect((caught as Error & { code?: string }).code).toBe('camera_not_found');
  });

  it('passes normal non-error IPC values through untouched', () => {
    expect(unpackIpcResult({ ok: true })).toEqual({ ok: true });
    expect(unpackIpcResult(null)).toBeNull();
    expect(unpackIpcResult([1, 2])).toEqual([1, 2]);
  });

  it('classifies expected helper/snapshot errors as debug and throttles transient ECONNREFUSED', () => {
    expect(
      classifyIpcError('haus:helper', new Error('Connect Haus Hub to record camera events.')),
    ).toBe('expected');
    expect(
      classifyIpcError(
        'haus:camera-snapshot',
        new Error('This camera is not providing a snapshot right now.'),
      ),
    ).toBe('expected');
    expect(
      classifyIpcError(
        'haus:management',
        new Error('The Hub request failed (500: hue_scene_diagnostics_unavailable).'),
      ),
    ).toBe('expected');
    expect(
      classifyIpcError(
        'haus:management',
        new Error(
          'Could not reach the Haus Hub at 192.168.4.44:8790 for /api/auth/pairing-requests (ECONNREFUSED).',
        ),
      ),
    ).toBe('transient');

    const emitted: Array<{ level: string; line: string }> = [];
    const mockLogger = createHausLogger('HubConn', {
      level: 'info',
      color: false,
      sink: {
        write(level, line) {
          emitted.push({ level, line });
        },
      },
    });

    logIpcError('haus:helper', new Error('Connect Haus Hub to record camera events.'), mockLogger);
    expect(emitted).toHaveLength(0);

    const outage = new Error('Could not reach the Haus Hub at 192.168.4.44:8790 (ECONNREFUSED).');
    logIpcError('haus:management', outage, mockLogger);
    logIpcError('haus:management', outage, mockLogger);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.level).toBe('warn');
  });
});
