/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AppManifest } from './manifest.js';

export type AppPermissionType =
  | 'network:host'
  | 'network:external'
  | 'mount:media'
  | 'mount:share'
  | 'mount:backup'
  | 'mount:config'
  | 'device:gpu'
  | 'device:video'
  | 'device:serial'
  | 'device:usb'
  | 'ingress'
  | 'port:privileged';

export interface AppPolicyViolation {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly critical: boolean;
}

export interface AppPolicyAssessment {
  readonly allowed: boolean;
  readonly requiredPermissions: readonly AppPermissionType[];
  readonly missingPermissions: readonly AppPermissionType[];
  readonly violations: readonly AppPolicyViolation[];
}

const FORBIDDEN_HOST_PATHS = [
  '/var/run/docker.sock',
  '/run/docker.sock',
  '/docker.sock',
  '/var/run',
  '/run',
  '/proc',
  '/sys',
  '/dev',
  '/etc',
  '/root',
  '/',
];

function isForbiddenHostPath(path: string): boolean {
  const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  if (path.includes('..')) return true;
  if (normalized.includes('docker.sock')) return true;
  return FORBIDDEN_HOST_PATHS.includes(normalized);
}

export function assessAppPermissions(
  manifest: AppManifest,
  grantedPermissions: readonly AppPermissionType[] = [],
): AppPolicyAssessment {
  const violations: AppPolicyViolation[] = [];
  const requiredPermissions = new Set<AppPermissionType>();

  // 1. Check mounts: forbid Docker socket and arbitrary host root/path grants
  if (manifest.mounts) {
    for (const mount of manifest.mounts) {
      if (mount.hostPath) {
        if (mount.hostPath.includes('docker.sock')) {
          violations.push({
            code: 'FORBIDDEN_DOCKER_SOCKET',
            message: 'Mounting the Docker socket into an app container is strictly prohibited.',
            path: `mounts.${mount.target}`,
            critical: true,
          });
        } else if (isForbiddenHostPath(mount.hostPath)) {
          violations.push({
            code: 'FORBIDDEN_HOST_MOUNT',
            message: `Arbitrary or sensitive host path "${mount.hostPath}" cannot be mounted. Docker socket and system paths are strictly forbidden.`,
            path: `mounts.${mount.target}`,
            critical: true,
          });
        }
      }

      if (mount.containerPath && mount.containerPath.includes('docker.sock')) {
        violations.push({
          code: 'FORBIDDEN_DOCKER_SOCKET',
          message: 'Mounting the Docker socket into an app container is strictly prohibited.',
          path: `mounts.${mount.target}`,
          critical: true,
        });
      }

      // Check mount permissions
      switch (mount.target) {
        case 'media':
          requiredPermissions.add('mount:media');
          break;
        case 'share':
          requiredPermissions.add('mount:share');
          break;
        case 'backup':
          requiredPermissions.add('mount:backup');
          break;
        case 'config':
          requiredPermissions.add('mount:config');
          break;
        case 'data':
          // Data is private isolated storage for the app, allowed by default
          break;
      }
    }
  }

  // 2. Check network permissions
  if (manifest.network?.mode === 'host') {
    requiredPermissions.add('network:host');
  }

  // 3. Check ports: host ports < 1024 require privileged port grant
  if (manifest.ports) {
    for (const port of manifest.ports) {
      if (port.hostPort !== undefined && port.hostPort > 0 && port.hostPort < 1024) {
        requiredPermissions.add('port:privileged');
      }
    }
  }

  // 4. Check device access
  if (manifest.devices) {
    for (const device of manifest.devices) {
      if (
        device.hostPath.includes('..') ||
        device.hostPath === '/' ||
        device.hostPath.includes('docker.sock')
      ) {
        violations.push({
          code: 'INVALID_DEVICE_PATH',
          message: `Device host path "${device.hostPath}" is invalid or attempts escape.`,
          path: 'devices',
          critical: true,
        });
      }

      switch (device.type) {
        case 'gpu':
          requiredPermissions.add('device:gpu');
          break;
        case 'video':
          requiredPermissions.add('device:video');
          break;
        case 'serial':
          requiredPermissions.add('device:serial');
          break;
        case 'usb':
          requiredPermissions.add('device:usb');
          break;
      }
    }
  }

  // 5. Ingress
  if (manifest.ingress?.enabled) {
    requiredPermissions.add('ingress');
  }

  // 6. Deny-by-default: check which required permissions are missing
  const grantedSet = new Set(grantedPermissions);
  const requiredArray = Array.from(requiredPermissions);
  const missingPermissions = requiredArray.filter((p) => !grantedSet.has(p));

  const allowed = violations.length === 0 && missingPermissions.length === 0;

  return {
    allowed,
    requiredPermissions: requiredArray,
    missingPermissions,
    violations,
  };
}
