/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  appendTerminalOutput,
  buildDemoServersState,
  formatBytes,
  formatPercent,
  formatRatio,
  formatUptime,
  resolveServerConnectionState,
  runDemoTerminalCommand,
  stripAnsiSequences,
  summarizeServerDisks,
} from '../../src/transport/index.js';

describe('@haus/core transport servers & terminal helpers', () => {
  it('formats bytes, ratios, percentages, and uptimes', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(6 * 1024 ** 3)).toBe('6 GB');
    expect(formatRatio(3, 6)).toBe(0.5);
    expect(formatPercent(0.256)).toBe('26%');
    expect(formatUptime(18 * 86_400 + 3600)).toBe('18d 1h');
    expect(formatUptime(3900)).toBe('1h 5m');
  });

  it('strips ANSI control sequences and caps terminal output lines', () => {
    expect(stripAnsiSequences('\u001b[32mOK\u001b[0m\r\nready')).toBe('OK\nready');
    const clipped = appendTerminalOutput('a\nb\nc\n', 'd\ne', 3);
    expect(clipped).toBe('c\nd\ne');
  });

  it('summarizes server disks, states, and demo shell commands', () => {
    expect(resolveServerConnectionState({ online: true, enabled: false })).toBe('paused');
    expect(resolveServerConnectionState({ online: true, enabled: true })).toBe('online');
    expect(resolveServerConnectionState({ online: false, enabled: true })).toBe('offline');

    const demo = buildDemoServersState();
    expect(demo.servers.map((s) => s.id)).toEqual(['haus-hub-main', 'nvr-node-garage']);
    const disks = summarizeServerDisks(demo.servers[0]?.disks ?? []);
    expect(disks.volumeCount).toBe(1);
    expect(Math.round((disks.usageRatio ?? 0) * 100)).toBe(34);

    expect(runDemoTerminalCommand('Willow Hub', 'clear')).toEqual({ output: '', clear: true });
    expect(runDemoTerminalCommand('Willow Hub', 'uptime').output).toContain('load average');
  });
});
