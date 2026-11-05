/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  buildHostCapabilityDependencyGraph,
  classifyContainerTier,
  ContainerTier,
  FakeHostAdapter,
  isPhysicalNetworkInterface,
  SystemHostAdapter,
  verifyTierPermissions,
  type AppManifest,
} from '../src/index.js';

describe('Host Adapters & System Capabilities', () => {
  it('extracts real OS process metrics and system info', async () => {
    const adapter = new SystemHostAdapter();
    const metrics = await adapter.getMetrics();

    expect(metrics.cpu.cores).toBeGreaterThan(0);
    expect(metrics.cpu.totalPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.cpu.totalPercent).toBeLessThanOrEqual(100);
    expect(metrics.memory.totalBytes).toBeGreaterThan(0);
    expect(metrics.memory.availableBytes).toBeGreaterThan(0);
    expect(metrics.system.uptimeSeconds).toBeGreaterThan(0);
    expect(['linux', 'darwin', 'win32', 'unknown']).toContain(metrics.system.platform);
    expect(['amd64', 'arm64', 'armv7', 'i386']).toContain(metrics.system.arch);
  });

  it('queries real host disk usage for root filesystem', async () => {
    const adapter = new SystemHostAdapter(['/']);
    const diskUsages = await adapter.getDiskUsage();

    expect(diskUsages.length).toBeGreaterThan(0);
    const rootDisk = diskUsages[0];
    expect(rootDisk.mountPoint).toBe('/');
    expect(rootDisk.totalBytes).toBeGreaterThan(0);
    expect(rootDisk.availableBytes).toBeGreaterThan(0);
    expect(rootDisk.usedPercent).toBeGreaterThanOrEqual(0);
    expect(rootDisk.usedPercent).toBeLessThanOrEqual(100);
  });

  it('distinguishes physical and virtual network interfaces', async () => {
    expect(isPhysicalNetworkInterface('lo')).toBe(false);
    expect(isPhysicalNetworkInterface('docker0')).toBe(false);
    expect(isPhysicalNetworkInterface('br-12345')).toBe(false);
    expect(isPhysicalNetworkInterface('vethabcd')).toBe(false);
    expect(isPhysicalNetworkInterface('tailscale0')).toBe(false);
    expect(isPhysicalNetworkInterface('eth0')).toBe(true);
    expect(isPhysicalNetworkInterface('en0')).toBe(true);
    expect(isPhysicalNetworkInterface('wlan0')).toBe(true);

    const adapter = new SystemHostAdapter();
    const ifaces = await adapter.getNetworkInterfaces();
    expect(ifaces.length).toBeGreaterThan(0);

    const lo = ifaces.find((i) => i.name === 'lo' || i.name.startsWith('lo'));
    if (lo) {
      expect(lo.physical).toBe(false);
    }
  });

  it('checks device access permissions on real filesystem', async () => {
    const adapter = new SystemHostAdapter();
    const exists = await adapter.checkDeviceAccess('/dev/null', 'rw');
    expect(exists).toBe(true);

    const missing = await adapter.checkDeviceAccess('/dev/nonexistent_dongle_99', 'rw');
    expect(missing).toBe(false);
  });
});

describe('Tiered Container Classification', () => {
  const baseManifest: AppManifest = {
    id: 'test-app',
    name: 'Test App',
    version: '1.0.0',
    image: 'haus/test:1.0.0',
    architectures: ['amd64', 'arm64'],
  };

  it('classifies ordinary unmanaged or minimal containers', () => {
    expect(classifyContainerTier(baseManifest, false)).toBe(ContainerTier.Ordinary);

    const minimalManaged: AppManifest = {
      ...baseManifest,
      mounts: [{ target: 'data', containerPath: '/data' }],
    };
    expect(classifyContainerTier(minimalManaged, true)).toBe(ContainerTier.Ordinary);
  });

  it('classifies simple apps requiring ingress, shared mounts, or options', () => {
    const withIngress: AppManifest = {
      ...baseManifest,
      ingress: { enabled: true, port: 8080 },
    };
    expect(classifyContainerTier(withIngress, true)).toBe(ContainerTier.Simple);

    const withSharedMount: AppManifest = {
      ...baseManifest,
      mounts: [{ target: 'media', containerPath: '/media' }],
    };
    expect(classifyContainerTier(withSharedMount, true)).toBe(ContainerTier.Simple);

    const withOptions: AppManifest = {
      ...baseManifest,
      options: [{ name: 'api_key', type: 'string' }],
    };
    expect(classifyContainerTier(withOptions, true)).toBe(ContainerTier.Simple);
  });

  it('classifies hardware apps requiring host devices or host network', () => {
    const withSerial: AppManifest = {
      ...baseManifest,
      devices: [{ type: 'serial', hostPath: '/dev/ttyUSB0' }],
    };
    expect(classifyContainerTier(withSerial, true)).toBe(ContainerTier.Hardware);

    const withHostNetwork: AppManifest = {
      ...baseManifest,
      network: { mode: 'host' },
    };
    expect(classifyContainerTier(withHostNetwork, true)).toBe(ContainerTier.Hardware);
  });
});

describe('Host Capability Dependency Graph & Tier Permissions', () => {
  const hardwareManifest: AppManifest = {
    id: 'zigbee2mqtt',
    name: 'Zigbee Coordinator App',
    version: '1.35.0',
    image: 'koenkk/zigbee2mqtt:1.35.0',
    architectures: ['amd64', 'arm64'],
    network: { mode: 'bridge' },
    resources: {
      memoryReservationMb: 256,
    },
    devices: [
      {
        type: 'serial',
        hostPath: '/dev/ttyUSB0',
        permissions: 'rw',
      },
    ],
    mounts: [
      { target: 'data', containerPath: '/app/data' },
      { target: 'share', containerPath: '/share' },
    ],
  };

  it('builds dependency graph with all required host capabilities', () => {
    const graph = buildHostCapabilityDependencyGraph(hardwareManifest);
    expect(graph.appId).toBe('zigbee2mqtt');
    expect(graph.tier).toBe(ContainerTier.Hardware);
    expect(graph.nodes.some((n) => n.kind === 'arch')).toBe(true);
    expect(graph.nodes.some((n) => n.kind === 'memory' && n.requirement.includes('256 MB'))).toBe(
      true,
    );
    expect(
      graph.nodes.some((n) => n.kind === 'device' && n.requirement.includes('/dev/ttyUSB0')),
    ).toBe(true);
    expect(graph.nodes.some((n) => n.kind === 'mount' && n.requirement.includes('share'))).toBe(
      true,
    );
  });

  it('verifies compatible hardware app when permissions and devices exist', async () => {
    const host = new FakeHostAdapter();
    const evaluation = await verifyTierPermissions(
      hardwareManifest,
      ['device:serial', 'mount:share'],
      host,
    );

    expect(evaluation.tier).toBe(ContainerTier.Hardware);
    expect(evaluation.compatible).toBe(true);
    expect(evaluation.missingCapabilities).toHaveLength(0);
    expect(evaluation.missingPermissions).toHaveLength(0);
    expect(evaluation.violations).toHaveLength(0);
  });

  it('rejects evaluation when required permissions are missing', async () => {
    const host = new FakeHostAdapter();
    // Missing device:serial permission
    const evaluation = await verifyTierPermissions(hardwareManifest, ['mount:share'], host);

    expect(evaluation.compatible).toBe(false);
    expect(evaluation.missingPermissions).toContain('device:serial');
  });

  it('flags missing capabilities when device node is unavailable on host', async () => {
    const host = new FakeHostAdapter(undefined, undefined, undefined, [], new Set());
    const evaluation = await verifyTierPermissions(
      hardwareManifest,
      ['device:serial', 'mount:share'],
      host,
    );

    expect(evaluation.compatible).toBe(false);
    expect(evaluation.missingCapabilities).toContain('device_unavailable:/dev/ttyUSB0');
  });

  it('flags unsupported architecture mismatch', async () => {
    const armOnlyManifest: AppManifest = {
      ...hardwareManifest,
      architectures: ['armv7'],
    };
    const host = new FakeHostAdapter(); // host reports amd64
    const evaluation = await verifyTierPermissions(
      armOnlyManifest,
      ['device:serial', 'mount:share'],
      host,
    );

    expect(evaluation.compatible).toBe(false);
    expect(evaluation.missingCapabilities).toContain('unsupported_architecture:amd64');
  });

  it('flags insufficient memory when host free memory is below reservation', async () => {
    const hugeMemManifest: AppManifest = {
      ...hardwareManifest,
      resources: { memoryReservationMb: 64 * 1024 }, // 64 GB
    };
    const host = new FakeHostAdapter(); // host has 12 GB available
    const evaluation = await verifyTierPermissions(
      hugeMemManifest,
      ['device:serial', 'mount:share'],
      host,
    );

    expect(evaluation.compatible).toBe(false);
    expect(evaluation.missingCapabilities.some((c) => c.startsWith('insufficient_memory'))).toBe(
      true,
    );
  });

  it('strictly blocks dangerous Docker socket mounts with critical policy violation', async () => {
    const dangerousManifest: AppManifest = {
      ...hardwareManifest,
      mounts: [
        {
          target: 'data',
          containerPath: '/var/run/docker.sock',
          hostPath: '/var/run/docker.sock',
        },
      ],
    };
    const host = new FakeHostAdapter();
    const evaluation = await verifyTierPermissions(
      dangerousManifest,
      ['device:serial', 'mount:share'],
      host,
    );

    expect(evaluation.compatible).toBe(false);
    expect(evaluation.violations.some((v) => v.code === 'FORBIDDEN_DOCKER_SOCKET')).toBe(true);
  });
});
