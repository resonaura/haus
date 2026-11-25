/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  buildDemoServiceConsoleOutput,
  buildServiceConsoleRequest,
  searchTerminalOutput,
  switchServiceConsoleMode,
} from '../../src/transport/index.js';

describe('@haus/core transport terminal helpers', () => {
  it('searches terminal output across plain, case-sensitive, whole-word, and regex modes', () => {
    const sample = [
      '[info] Docker container starting',
      '[warn] docker-compose deprecated',
      '[info] DOCKER health ok',
    ].join('\n');

    expect(
      searchTerminalOutput(sample, '', { caseSensitive: false, wholeWord: false, regex: false }),
    ).toEqual({
      matches: [],
      matchingLineIndices: [],
    });

    const insensitive = searchTerminalOutput(sample, 'docker', {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(insensitive.matches).toHaveLength(3);
    expect(insensitive.matchingLineIndices).toEqual([0, 1, 2]);

    const sensitive = searchTerminalOutput(sample, 'Docker', {
      caseSensitive: true,
      wholeWord: false,
      regex: false,
    });
    expect(sensitive.matches).toHaveLength(1);
    expect(sensitive.matches[0]?.lineIndex).toBe(0);

    const whole = searchTerminalOutput('cat catalog cat.', 'cat', {
      caseSensitive: false,
      wholeWord: true,
      regex: false,
    });
    expect(whole.matches.map((m) => m.start)).toEqual([0, 12]);

    const zeroLength = searchTerminalOutput('ab', 'a*', {
      caseSensitive: false,
      wholeWord: false,
      regex: true,
    });
    expect(zeroLength.matches).toHaveLength(1);
    expect(zeroLength.error).toBeUndefined();

    const invalid = searchTerminalOutput(sample, '[unclosed', {
      caseSensitive: false,
      wholeWord: false,
      regex: true,
    });
    expect(invalid.matches).toEqual([]);
    expect(invalid.error).toBe('Invalid regular expression');
  });

  it('builds and switches per-service Docker, PM2, and systemd console requests', () => {
    const dockerLogs = buildServiceConsoleRequest(
      { id: 'zigbee2mqtt', name: 'Zigbee2MQTT', manager: 'docker', running: true },
      'logs',
    );
    expect(dockerLogs).toEqual({
      title: 'Zigbee2MQTT · Logs',
      containerId: 'zigbee2mqtt',
      running: true,
      target: { kind: 'docker-logs', containerId: 'zigbee2mqtt', tail: 500 },
    });

    const dockerExec = switchServiceConsoleMode(dockerLogs, 'terminal');
    expect(dockerExec).toEqual({
      title: 'Zigbee2MQTT · Terminal',
      containerId: 'zigbee2mqtt',
      running: true,
      target: { kind: 'docker-exec', containerId: 'zigbee2mqtt' },
    });
    expect(switchServiceConsoleMode(dockerExec, 'logs')).toEqual(dockerLogs);

    const systemdLogs = buildServiceConsoleRequest(
      { id: 'haus-hub.service', name: 'Haus Hub Core', manager: 'systemServices', running: true },
      'terminal',
    );
    expect(systemdLogs).toEqual({
      title: 'Haus Hub Core · Logs',
      target: {
        kind: 'service-logs',
        manager: 'systemd',
        serviceId: 'haus-hub.service',
        tail: 400,
      },
    });
    expect(switchServiceConsoleMode(systemdLogs, 'terminal')).toEqual(systemdLogs);

    const pm2Logs = buildServiceConsoleRequest(
      { id: 'media-worker', name: 'Media Worker', manager: 'pm2', running: true },
      'logs',
    );
    expect(pm2Logs.target).toEqual({
      kind: 'service-logs',
      manager: 'pm2',
      serviceId: 'media-worker',
      tail: 400,
    });

    expect(buildDemoServiceConsoleOutput('Willow Hub', dockerLogs)).toContain('Willow Hub');
    expect(buildDemoServiceConsoleOutput('Willow Hub', dockerExec)).toContain('zigbee2mqtt');
    expect(buildDemoServiceConsoleOutput('Willow Hub', systemdLogs)).toContain('systemd');
  });
});
