/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  computeInstallProgressPercent,
  formatByteProgress,
  formatInstallStageTitle,
  parseColoredLogLine,
} from '../src/components/servers/operation-progress.js';

describe('OperationProgressPanel & ColoredLogViewer helpers', () => {
  it('parses ANSI 16, 256, and 24-bit RGB escape sequences into colored segments', () => {
    const line =
      '\x1b[90m[12:34:56]\x1b[0m \x1b[1;36m[PULL]\x1b[0m \x1b[38;2;52;199;89mLayer ready\x1b[0m';
    const segments = parseColoredLogLine(line, true);
    expect(segments).toEqual([
      { text: '[12:34:56]', color: '#8a8f98', bold: false, dim: false },
      { text: ' ', color: undefined, bold: false, dim: false },
      { text: '[PULL]', color: '#92dcff', bold: true, dim: false },
      { text: ' ', color: undefined, bold: false, dim: false },
      { text: 'Layer ready', color: 'rgb(52, 199, 89)', bold: false, dim: false },
    ]);
  });

  it('auto-highlights plain-text structured timestamps and severity tags', () => {
    const okSegs = parseColoredLogLine('2026-11-26T08:49:29Z [OK] Peer keys verified', true);
    expect(okSegs[0]).toMatchObject({ text: '2026-11-26T08:49:29Z ', dim: true });
    expect(okSegs[1]).toMatchObject({ text: '[OK] ', color: '#34c759', bold: true });
    expect(okSegs[2]).toMatchObject({ text: 'Peer keys verified' });

    const errSegs = parseColoredLogLine('[ERROR] Docker pull failed', false);
    expect(errSegs[0]).toMatchObject({ text: '[ERROR] ', color: '#d92d20', bold: true });
  });

  it('computes monotonic stage percentages and formats byte download progress', () => {
    expect(computeInstallProgressPercent('validating')).toBe(8);
    expect(computeInstallProgressPercent('pulling', 50, 100)).toBe(50);
    expect(computeInstallProgressPercent('complete')).toBe(100);
    expect(formatByteProgress(15 * 1024 * 1024, 30 * 1024 * 1024)).toBe('15.0 MB / 30.0 MB');
    expect(formatInstallStageTitle('creating')).toBe('Creating isolated container…');
  });
});
