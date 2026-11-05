/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AppManifest } from '../manifest.js';
import {
  assessAppPermissions,
  type AppPermissionType,
  type AppPolicyViolation,
} from '../policy.js';
import { ContainerTier, type HostAdapter, type HostCapabilityEvaluation } from './types.js';

export function classifyContainerTier(
  manifest: AppManifest,
  managed: boolean = true,
): ContainerTier {
  const hasDevices = Boolean(manifest.devices && manifest.devices.length > 0);
  const hasHostNetwork = manifest.network?.mode === 'host';

  if (hasDevices || hasHostNetwork) {
    return ContainerTier.Hardware;
  }

  const hasIngress = Boolean(manifest.ingress?.enabled);
  const hasSharedMounts = Boolean(
    manifest.mounts && manifest.mounts.some((m) => m.target !== 'data'),
  );
  const hasHostPorts = Boolean(
    manifest.ports && manifest.ports.some((p) => p.hostPort !== undefined),
  );
  const hasOptionsOrSecrets = Boolean(
    (manifest.options && manifest.options.length > 0) ||
    (manifest.secrets && manifest.secrets.length > 0),
  );

  if (managed && (hasIngress || hasSharedMounts || hasHostPorts || hasOptionsOrSecrets)) {
    return ContainerTier.Simple;
  }

  return ContainerTier.Ordinary;
}

export interface HostCapabilityNode {
  readonly id: string;
  readonly kind: 'arch' | 'memory' | 'device' | 'network' | 'mount';
  readonly requirement: string;
  readonly optional: boolean;
}

export interface HostCapabilityDependencyGraph {
  readonly appId: string;
  readonly tier: ContainerTier;
  readonly nodes: readonly HostCapabilityNode[];
}

export function buildHostCapabilityDependencyGraph(
  manifest: AppManifest,
): HostCapabilityDependencyGraph {
  const tier = classifyContainerTier(manifest, true);
  const nodes: HostCapabilityNode[] = [];

  // Architecture node
  nodes.push({
    id: `arch:${manifest.architectures.join(',')}`,
    kind: 'arch',
    requirement: `Supported architectures: ${manifest.architectures.join(', ')}`,
    optional: false,
  });

  // Memory node
  if (manifest.resources?.memoryReservationMb) {
    nodes.push({
      id: `memory:${manifest.resources.memoryReservationMb}MB`,
      kind: 'memory',
      requirement: `Minimum reserved memory: ${manifest.resources.memoryReservationMb} MB`,
      optional: false,
    });
  }

  // Device nodes
  if (manifest.devices) {
    for (const dev of manifest.devices) {
      nodes.push({
        id: `device:${dev.hostPath}`,
        kind: 'device',
        requirement: `Host device: ${dev.hostPath} (${dev.type})`,
        optional: false,
      });
    }
  }

  // Network node
  if (manifest.network?.mode) {
    nodes.push({
      id: `network:${manifest.network.mode}`,
      kind: 'network',
      requirement: `Network mode: ${manifest.network.mode}`,
      optional: false,
    });
  }

  // Mount nodes
  if (manifest.mounts) {
    for (const mount of manifest.mounts) {
      nodes.push({
        id: `mount:${mount.target}`,
        kind: 'mount',
        requirement: `Mount volume target: ${mount.target}`,
        optional: false,
      });
    }
  }

  return {
    appId: manifest.id,
    tier,
    nodes,
  };
}

export async function verifyTierPermissions(
  manifest: AppManifest,
  grantedPermissions: readonly AppPermissionType[],
  hostAdapter: HostAdapter,
): Promise<HostCapabilityEvaluation> {
  const tier = classifyContainerTier(manifest, true);
  const policyAssessment = assessAppPermissions(manifest, grantedPermissions);
  const missingCapabilities: string[] = [];
  const violations: AppPolicyViolation[] = [...policyAssessment.violations];

  // 1. Check Architecture and Memory
  try {
    const metrics = await hostAdapter.getMetrics();
    const hostArch = metrics.system.arch;

    if (!manifest.architectures.includes(hostArch)) {
      missingCapabilities.push(`unsupported_architecture:${hostArch}`);
    }

    if (manifest.resources?.memoryReservationMb) {
      const requiredBytes = manifest.resources.memoryReservationMb * 1024 * 1024;
      if (metrics.memory.availableBytes < requiredBytes) {
        missingCapabilities.push(
          `insufficient_memory:required_${manifest.resources.memoryReservationMb}MB_available_${Math.round(metrics.memory.availableBytes / (1024 * 1024))}MB`,
        );
      }
    }
  } catch (err) {
    violations.push({
      code: 'HOST_METRICS_UNAVAILABLE',
      message: `Failed to query host metrics: ${String(err)}`,
      critical: true,
    });
  }

  // 2. Check Device Nodes
  if (manifest.devices && manifest.devices.length > 0) {
    for (const dev of manifest.devices) {
      const mode = dev.permissions === 'rw' || dev.permissions === 'rwm' ? 'rw' : 'r';
      const accessible = await hostAdapter.checkDeviceAccess(dev.hostPath, mode);
      if (!accessible) {
        missingCapabilities.push(`device_unavailable:${dev.hostPath}`);
      }
    }
  }

  // 3. Check Disk Storage for Mounts
  if (manifest.mounts && manifest.mounts.length > 0) {
    try {
      const diskUsages = await hostAdapter.getDiskUsage();
      const hasUsableDisk = diskUsages.some((d) => d.availableBytes > 0);
      if (diskUsages.length > 0 && !hasUsableDisk) {
        missingCapabilities.push('disk_full:no_available_storage');
      }
    } catch {
      // Disk check non-critical if host doesn't expose statfs
    }
  }

  const compatible =
    policyAssessment.allowed && violations.length === 0 && missingCapabilities.length === 0;

  return {
    tier,
    compatible,
    missingCapabilities,
    missingPermissions: policyAssessment.missingPermissions,
    violations,
    evaluatedAt: new Date().toISOString(),
  };
}
