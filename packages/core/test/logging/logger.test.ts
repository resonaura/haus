/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  createHausLogger,
  formatHausLogLine,
  formatLogError,
  moduleAnsiColor,
  redactLogText,
} from '../../src/logger.js';

describe('@haus/core unified logger', () => {
  it('assigns distinct ANSI colors to different modules deterministically', () => {
    const hubColor = moduleAnsiColor('Hub');
    const mqttColor = moduleAnsiColor('MQTT');
    const tuyaColor = moduleAnsiColor('Tuya');
    const cameraColor = moduleAnsiColor('Camera');
    expect(new Set([hubColor, mqttColor, tuyaColor, cameraColor]).size).toBe(4);
    expect(moduleAnsiColor('CustomMod')).toBe(moduleAnsiColor('CustomMod'));
    expect(moduleAnsiColor('Tuya:Bridge')).toBe(tuyaColor);
  });

  it('redacts bearer tokens, secrets, passwords, and newlines', () => {
    const line = redactLogText(
      'Auth failed Bearer eyJhbGciOiJIUzI1NiJ9.secret\nlocal_key=abcd1234 password="top" ok',
    );
    expect(line).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(line).not.toContain('abcd1234');
    expect(line).not.toContain('top');
    expect(line).not.toContain('\n');
    expect(line).toContain('Bearer [redacted]');
    expect(line).toContain('local_key=[redacted]');
    expect(line).toContain('password=[redacted]');
  });

  it('formats compact single-line error summaries including nested cause codes', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 192.168.4.44:8790'), {
      code: 'ECONNREFUSED',
    });
    const err = new TypeError('fetch failed', { cause });
    expect(formatLogError(err)).toContain('fetch failed');
    expect(formatLogError(err)).toContain('ECONNREFUSED');
  });

  it('formats aligned colored and plain log lines with level, timestamp, and module', () => {
    const fixed = new Date(2026, 10, 20, 9, 5, 3, 42);
    const plain = formatHausLogLine({
      level: 'info',
      module: 'MQTT',
      message: 'Broker connected',
      color: false,
      now: fixed,
    });
    expect(plain).toBe('09:05:03.042  INF  [MQTT]       Broker connected');

    const colored = formatHausLogLine({
      level: 'warn',
      module: 'Tuya',
      message: 'Session expired',
      color: true,
      now: fixed,
    });
    expect(colored).toContain('\x1b[');
    expect(colored).toContain('WRN');
    expect(colored).toContain('[Tuya]');
    expect(colored).toContain('Session expired');
  });

  it('respects log level thresholds and throttles repeated warnings per key', () => {
    let clock = 1_000;
    const lines: Array<{ level: string; line: string }> = [];
    const log = createHausLogger('HubConn', {
      level: 'info',
      color: false,
      now: () => new Date(clock),
      sink: {
        write(level, line) {
          lines.push({ level, line });
        },
      },
    });

    log.debug('ignored debug');
    log.info('connected');
    log.warnThrottled('econnrefused', 'Hub unreachable', 10_000);
    clock += 3_000;
    log.warnThrottled('econnrefused', 'Hub unreachable again', 10_000);
    clock += 10_000;
    log.warnThrottled('econnrefused', 'Hub still unreachable', 10_000);

    expect(lines).toHaveLength(3);
    expect(lines[0]!.level).toBe('info');
    expect(lines[1]!.line).toContain('Hub unreachable');
    expect(lines[2]!.line).toContain('Hub still unreachable');
  });
});
