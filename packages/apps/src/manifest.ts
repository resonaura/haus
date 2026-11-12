/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { AppAccessoryEndpoint } from './accessories.js';

export type AppArchitecture = 'amd64' | 'arm64' | 'armv7' | 'i386';

export interface AppHealthCheck {
  readonly intervalSeconds?: number;
  readonly timeoutSeconds?: number;
  readonly retries?: number;
  readonly startPeriodSeconds?: number;
  readonly path?: string;
  readonly port?: number;
  readonly test?: readonly string[];
}

export type AppOptionType = 'string' | 'number' | 'boolean' | 'select' | 'list';

export interface AppOptionSchema {
  readonly name: string;
  readonly type: AppOptionType;
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly choices?: readonly (string | number)[];
}

export interface AppSecretDeclaration {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface AppPortMapping {
  readonly containerPort: number;
  readonly hostPort?: number;
  readonly protocol?: 'tcp' | 'udp';
  readonly ingressOnly?: boolean;
}

export type AppMountTarget = 'data' | 'media' | 'share' | 'backup' | 'config';

export interface AppMount {
  readonly target: AppMountTarget;
  readonly containerPath: string;
  readonly readOnly?: boolean;
  /** Explicit forbidden custom host path; Haus manages mount locations. */
  readonly hostPath?: string;
}

export type AppDeviceType = 'gpu' | 'video' | 'serial' | 'usb';

export interface AppDevice {
  readonly type: AppDeviceType;
  readonly hostPath: string;
  readonly containerPath?: string;
  readonly permissions?: 'r' | 'w' | 'rw' | 'rwm';
}

export type AppNetworkMode = 'bridge' | 'host' | 'internal' | 'none';

export interface AppNetwork {
  readonly mode: AppNetworkMode;
}

export interface AppResources {
  readonly cpuLimit?: number;
  readonly memoryLimitMb?: number;
  readonly memoryReservationMb?: number;
}

export interface AppIngress {
  readonly enabled: boolean;
  readonly port: number;
  readonly slug?: string;
  readonly title?: string;
  readonly websocket?: boolean;
}

export type AppRestartPolicy = 'no' | 'always' | 'on-failure' | 'unless-stopped';

export interface AppLifecycle {
  readonly restartPolicy?: AppRestartPolicy;
  readonly stopTimeoutSeconds?: number;
}

export interface AppBuildRecipe {
  /** Public GitHub repository URL; build contexts must not contain credentials. */
  readonly repository: string;
  /** Full immutable Git commit hash. */
  readonly commit: string;
  /** Repository-relative build context, defaulting to the repository root. */
  readonly context?: string;
  /** Dockerfile path relative to the build context. */
  readonly dockerfile?: string;
}

export interface AppManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly image: string;
  readonly description?: string;
  readonly architectures: readonly AppArchitecture[];
  readonly health?: AppHealthCheck;
  readonly options?: readonly AppOptionSchema[];
  readonly secrets?: readonly AppSecretDeclaration[];
  readonly ports?: readonly AppPortMapping[];
  readonly mounts?: readonly AppMount[];
  readonly devices?: readonly AppDevice[];
  readonly network?: AppNetwork;
  readonly resources?: AppResources;
  readonly ingress?: AppIngress;
  readonly lifecycle?: AppLifecycle;
  readonly build?: AppBuildRecipe;
  readonly dependencies?: readonly string[];
  readonly accessories?: AppAccessoryEndpoint;
  readonly services?: readonly string[];
  readonly env?: readonly string[] | Record<string, string>;
  readonly cmd?: readonly string[];
}

export interface AppManifestValidationResult {
  readonly valid: boolean;
  readonly manifest?: AppManifest;
  readonly errors: readonly string[];
}

const ID_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const VALID_ARCHS: readonly AppArchitecture[] = ['amd64', 'arm64', 'armv7', 'i386'];
const VALID_MOUNT_TARGETS: readonly AppMountTarget[] = [
  'data',
  'media',
  'share',
  'backup',
  'config',
];
const VALID_NETWORK_MODES: readonly AppNetworkMode[] = ['bridge', 'host', 'internal', 'none'];
const GITHUB_REPOSITORY_REGEX =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const SAFE_REPOSITORY_PATH = /^(?:\.|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)$/;
const DOCKER_IMAGE_REGEX =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)?[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;

function validBuildPath(path: unknown): boolean {
  if (typeof path !== 'string' || !SAFE_REPOSITORY_PATH.test(path)) return false;
  return path === '.' || path.split('/').every((segment) => segment !== '.' && segment !== '..');
}

function validImageReference(reference: unknown): reference is string {
  return (
    typeof reference === 'string' &&
    DOCKER_IMAGE_REGEX.test(reference) &&
    !reference.includes('//') &&
    !reference.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

export function validateAppManifest(input: unknown): AppManifestValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw.id !== 'string' || !ID_REGEX.test(raw.id)) {
    errors.push('id must be lowercase kebab-case (2-64 chars, e.g. "zigbee2mqtt")');
  }

  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    errors.push('name must be a non-empty string');
  }

  if (typeof raw.version !== 'string' || raw.version.trim().length === 0) {
    errors.push('version must be a non-empty string');
  }

  if (!validImageReference(raw.image)) {
    errors.push('image must be a valid Docker image reference');
  }

  if (
    !Array.isArray(raw.architectures) ||
    raw.architectures.length === 0 ||
    !raw.architectures.every(
      (a) => typeof a === 'string' && VALID_ARCHS.includes(a as AppArchitecture),
    )
  ) {
    errors.push(
      `architectures must be a non-empty array of valid architectures (${VALID_ARCHS.join(', ')})`,
    );
  }

  if (raw.ports !== undefined) {
    if (!Array.isArray(raw.ports)) {
      errors.push('ports must be an array');
    } else {
      for (const p of raw.ports) {
        if (
          !p ||
          typeof p !== 'object' ||
          typeof p.containerPort !== 'number' ||
          p.containerPort < 1 ||
          p.containerPort > 65535
        ) {
          errors.push('each port must specify a valid containerPort (1-65535)');
        }
      }
    }
  }

  if (raw.mounts !== undefined) {
    if (!Array.isArray(raw.mounts)) {
      errors.push('mounts must be an array');
    } else {
      for (const m of raw.mounts) {
        if (!m || typeof m !== 'object') {
          errors.push('each mount must be an object');
          continue;
        }
        if (!VALID_MOUNT_TARGETS.includes(m.target)) {
          errors.push(`mount target must be one of: ${VALID_MOUNT_TARGETS.join(', ')}`);
        }
        if (typeof m.containerPath !== 'string' || !m.containerPath.startsWith('/')) {
          errors.push('containerPath must be an absolute path starting with "/"');
        }
      }
    }
  }

  if (raw.network !== undefined) {
    if (
      !raw.network ||
      typeof raw.network !== 'object' ||
      !VALID_NETWORK_MODES.includes((raw.network as AppNetwork).mode)
    ) {
      errors.push(`network.mode must be one of: ${VALID_NETWORK_MODES.join(', ')}`);
    }
  }

  if (raw.ingress !== undefined) {
    const ing = raw.ingress as Partial<AppIngress>;
    if (
      !ing ||
      typeof ing !== 'object' ||
      typeof ing.enabled !== 'boolean' ||
      typeof ing.port !== 'number' ||
      ing.port < 1 ||
      ing.port > 65535
    ) {
      errors.push('ingress must specify enabled (boolean) and a valid port (1-65535)');
    }
  }

  if (raw.accessories !== undefined) {
    const endpoint = raw.accessories;
    if (
      !endpoint ||
      typeof endpoint !== 'object' ||
      Array.isArray(endpoint) ||
      !('protocol' in endpoint) ||
      endpoint.protocol !== 'haus-camera-v2' ||
      !('port' in endpoint) ||
      typeof endpoint.port !== 'number' ||
      !Number.isInteger(endpoint.port) ||
      endpoint.port < 1 ||
      endpoint.port > 65535 ||
      Object.keys(endpoint).some((key) => !['protocol', 'port'].includes(key))
    ) {
      errors.push('accessories must declare a haus-camera-v2 protocol and a valid port');
    }
  }

  if (raw.build !== undefined) {
    const build = raw.build as Partial<AppBuildRecipe> | null;
    if (!build || typeof build !== 'object' || Array.isArray(build)) {
      errors.push('build must be an object');
    } else {
      if (typeof build.repository !== 'string' || !GITHUB_REPOSITORY_REGEX.test(build.repository)) {
        errors.push('build.repository must be a public HTTPS GitHub repository URL');
      }
      if (typeof build.commit !== 'string' || !/^[a-f0-9]{40}$/i.test(build.commit)) {
        errors.push('build.commit must be a full 40-character Git commit hash');
      }
      if (build.context !== undefined && !validBuildPath(build.context)) {
        errors.push('build.context must be a safe repository-relative path');
      }
      if (build.dockerfile !== undefined && !validBuildPath(build.dockerfile)) {
        errors.push('build.dockerfile must be a safe context-relative path');
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    manifest: input as AppManifest,
    errors: [],
  };
}
