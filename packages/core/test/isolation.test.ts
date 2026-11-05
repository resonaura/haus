/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  EnvironmentIsolationGuard,
  IsolationViolationError,
  normalizeHost,
  validateSafetyBoundary,
  validateStorageContainment,
  inspectSocketTableForSafety,
  validatePortAvailability,
  type SafetyBoundary,
  type StorageSandboxConfig,
  type PlannedPort,
  type ActiveSocketConnection,
} from '../src/cluster/isolation.js';

describe('Isolation and Safety Boundary Verification (P6.1)', () => {
  const boundary: SafetyBoundary = {
    forbiddenTargets: ['192.168.4.44', '192.168.5.117', 'prod-ha.local'],
    allowedHosts: ['127.0.0.1', '::1', '192.168.5.115', 'localhost'],
  };

  const storageConfig: StorageSandboxConfig = {
    sandboxRoot: 'C:/haus-black-laptop-test',
    requiredSubdirs: ['data', 'vault', 'media', 'cache'],
  };

  const plannedPorts: readonly PlannedPort[] = [
    { service: 'hub_http', port: 8790, protocol: 'tcp' },
    { service: 'mqtt_broker', port: 18883, protocol: 'tcp' },
    { service: 'homekit_bridge', port: 51828, protocol: 'tcp' },
    { service: 'matter_udp', port: 5541, protocol: 'udp' },
  ];

  describe('normalizeHost', () => {
    it('normalizes IP and hostnames with scheme and ports', () => {
      expect(normalizeHost('http://192.168.4.44:8123/api')).toBe('192.168.4.44');
      expect(normalizeHost('https://prod-ha.local:8123')).toBe('prod-ha.local');
      expect(normalizeHost('192.168.5.115:8790')).toBe('192.168.5.115');
      expect(normalizeHost('[::1]:8080')).toBe('::1');
      expect(normalizeHost('  192.168.4.44  ')).toBe('192.168.4.44');
    });
  });

  describe('validateSafetyBoundary', () => {
    it('strictly rejects active production Home Assistant host', () => {
      const result = validateSafetyBoundary(boundary, 'http://192.168.4.44:8123');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('matches forbidden production host');
    });

    it('strictly rejects active production NVR host', () => {
      const result = validateSafetyBoundary(boundary, '192.168.5.117:8098');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('matches forbidden production host');
    });

    it('rejects unallowed unknown hosts outside allowedHosts', () => {
      const result = validateSafetyBoundary(boundary, '192.168.1.100');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('not in the explicit allowedHosts list');
    });

    it('permits authorized Black Laptop and loopback addresses', () => {
      expect(validateSafetyBoundary(boundary, '192.168.5.115').safe).toBe(true);
      expect(validateSafetyBoundary(boundary, 'http://127.0.0.1:8790').safe).toBe(true);
      expect(validateSafetyBoundary(boundary, 'localhost').safe).toBe(true);
    });
  });

  describe('validateStorageContainment', () => {
    it('accepts valid subpaths within sandbox', () => {
      const res = validateStorageContainment(
        'C:/haus-black-laptop-test',
        'C:/haus-black-laptop-test/data/vault.sqlite',
      );
      expect(res.contained).toBe(true);
      expect(res.resolvedPath).toBe('C:/haus-black-laptop-test/data/vault.sqlite');
    });

    it('accepts Windows backslash paths', () => {
      const res = validateStorageContainment(
        'C:\\haus-black-laptop-test',
        'C:\\haus-black-laptop-test\\vault\\keys.json',
      );
      expect(res.contained).toBe(true);
      expect(res.resolvedPath).toBe('C:/haus-black-laptop-test/vault/keys.json');
    });

    it('rejects path traversal attempting to escape sandbox', () => {
      const res = validateStorageContainment(
        'C:/haus-black-laptop-test',
        'C:/haus-black-laptop-test/../../Windows/System32',
      );
      expect(res.contained).toBe(false);
    });

    it('rejects paths targeting other drives or root paths', () => {
      const res = validateStorageContainment('C:/haus-black-laptop-test', 'D:/other-folder');
      expect(res.contained).toBe(false);
    });
  });

  describe('inspectSocketTableForSafety', () => {
    it('detects active connection pointing to production HA service port 8123', () => {
      const conns: ActiveSocketConnection[] = [
        {
          localAddress: '192.168.5.115',
          localPort: 54321,
          remoteAddress: '192.168.4.44',
          remotePort: 8123,
          state: 'ESTABLISHED',
        },
      ];
      const check = inspectSocketTableForSafety(conns, boundary.forbiddenTargets);
      expect(check.safe).toBe(false);
      expect(check.violations.length).toBe(1);
    });

    it('filters out unrelated background OS traffic to non-service ports', () => {
      const conns: ActiveSocketConnection[] = [
        {
          localAddress: '192.168.5.115',
          localPort: 58048,
          remoteAddress: '192.168.5.117',
          remotePort: 445,
          state: 'ESTABLISHED',
        },
      ];
      const check = inspectSocketTableForSafety(conns, boundary.forbiddenTargets);
      expect(check.safe).toBe(true);
      expect(check.violations.length).toBe(0);
    });

    it('flags any connection from test processes regardless of port', () => {
      const conns: ActiveSocketConnection[] = [
        {
          localAddress: '192.168.5.115',
          localPort: 54322,
          remoteAddress: '192.168.4.44',
          remotePort: 9999,
          state: 'ESTABLISHED',
          processId: 12345,
        },
      ];
      const check = inspectSocketTableForSafety(conns, boundary.forbiddenTargets, {
        testProcessIds: [12345],
      });
      expect(check.safe).toBe(false);
      expect(check.violations.length).toBe(1);
    });

    it('passes when connections only point to loopback or local peers', () => {
      const conns: ActiveSocketConnection[] = [
        {
          localAddress: '127.0.0.1',
          localPort: 8790,
          remoteAddress: '127.0.0.1',
          remotePort: 54320,
          state: 'ESTABLISHED',
        },
      ];
      const check = inspectSocketTableForSafety(conns, boundary.forbiddenTargets);
      expect(check.safe).toBe(true);
      expect(check.violations.length).toBe(0);
    });
  });

  describe('validatePortAvailability', () => {
    it('reports available when none of planned ports are listening', () => {
      const check = validatePortAvailability([80, 443, 22], plannedPorts);
      expect(check.available).toBe(true);
      expect(check.conflicts).toEqual([]);
    });

    it('detects conflict when planned port is occupied', () => {
      const check = validatePortAvailability([8790, 22], plannedPorts);
      expect(check.available).toBe(false);
      expect(check.conflicts).toEqual([8790]);
    });
  });

  describe('EnvironmentIsolationGuard', () => {
    const guard = new EnvironmentIsolationGuard(
      '192.168.5.115',
      boundary,
      storageConfig,
      plannedPorts,
    );

    it('throws IsolationViolationError on forbidden targets', () => {
      expect(() => guard.assertTargetAllowed('http://192.168.4.44:8123')).toThrow(
        IsolationViolationError,
      );
      expect(() => guard.assertTargetAllowed('http://192.168.5.117:8098')).toThrow(
        IsolationViolationError,
      );
    });

    it('resolves valid sandbox subpaths and throws on escapes', () => {
      const valid = guard.resolveSandboxPath('data/db.sqlite');
      expect(valid).toBe('C:/haus-black-laptop-test/data/db.sqlite');

      expect(() => guard.resolveSandboxPath('../escape.txt')).toThrow(IsolationViolationError);
    });

    it('evaluates clean isolated report when no violations exist', () => {
      const report = guard.evaluateIsolation({
        activeConnections: [
          {
            localAddress: '127.0.0.1',
            localPort: 8790,
            remoteAddress: '127.0.0.1',
            remotePort: 51234,
            state: 'ESTABLISHED',
          },
        ],
        listeningPorts: [22, 135, 445],
      });

      expect(report.isolated).toBe(true);
      expect(report.violations.length).toBe(0);
      expect(report.checks.every((c) => c.ok)).toBe(true);
    });

    it('evaluates violation report when forbidden connections exist', () => {
      const report = guard.evaluateIsolation({
        activeConnections: [
          {
            localAddress: '192.168.5.115',
            localPort: 54321,
            remoteAddress: '192.168.4.44',
            remotePort: 8123,
            state: 'ESTABLISHED',
          },
        ],
        listeningPorts: [8790],
      });

      expect(report.isolated).toBe(false);
      expect(report.violations.length).toBe(2);
      expect(report.violations[0]).toContain('192.168.4.44:8123');
      expect(report.violations[1]).toContain('8790');
    });
  });
});
