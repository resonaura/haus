import { expect, it } from 'vitest';
import { normalizeServiceCpu, serviceCpuBasis, serviceUsageScore } from './service-usage-score';
import type { ServerHost } from './types';

it('normalizes provider contracts once and never guesses Docker units from the client OS', () => {
  expect(normalizeServiceCpu(200, 'core', 8)).toBe(25);
  expect(normalizeServiceCpu(25, 'host', 8)).toBe(25);
  expect(normalizeServiceCpu(25, 'host', null)).toBe(25);
  expect(normalizeServiceCpu(200, null, 8)).toBeNull();
  expect(normalizeServiceCpu(200, 'core', null)).toBeNull();
  const host = {
    platform: 'win32',
    docker: { source: 'host-collector' },
    pm2: { source: 'pidusage' },
  } as ServerHost;
  expect(serviceCpuBasis(host, 'docker')).toBeNull();
  expect(serviceCpuBasis(host, 'pm2')).toBe('core');
  host.pm2.cpuPercentBasis = null;
  expect(serviceCpuBasis(host, 'pm2')).toBeNull();
  host.docker.cpuPercentBasis = 'core';
  expect(serviceCpuBasis(host, 'docker')).toBe('core');
});
it('either resource can dominate usage, simultaneous pressure increases it, and saturation is bounded', () => {
  expect(serviceUsageScore(95, 1, 100)).toBeGreaterThanOrEqual(0.95);
  expect(serviceUsageScore(1, 95, 100)).toBeGreaterThanOrEqual(0.95);
  expect(serviceUsageScore(70, 70, 100)).toBeGreaterThan(serviceUsageScore(70, 0, 100)!);
  expect(serviceUsageScore(100, 100, 100)).toBe(1);
  expect(serviceUsageScore(null, null, 100)).toBeNull();
  expect(serviceUsageScore(null, 30, 100)).toBeCloseTo(0.3);
});
