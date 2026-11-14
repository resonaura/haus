/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  AppArchitecture,
  AppDevice,
  AppManifest,
  AppMount,
  AppNetwork,
  AppOptionSchema,
  AppPermissionType,
  AppPortMapping,
  AppSecretDeclaration,
} from '@haus/apps';
import { record } from './api';

export interface CatalogAppSummary {
  id: string;
  name: string;
  description?: string;
  category: string;
  runtimeType: string;
  channel: string;
  featured: boolean;
  documentationUrl?: string;
  repositoryUrl?: string;
  author?: string;
  installed: boolean;
  state?: string;
  currentVersion?: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes?: string;
}

export interface CatalogAppDetail {
  manifest: AppManifest;
  category: string;
  runtimeType: string;
  author?: string;
  documentationUrl?: string;
  repositoryUrl?: string;
}

export interface AppUpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  requiredPermissions: AppPermissionType[];
}

export interface AppInstallProgress {
  appId: string;
  stage: string;
  current?: number;
  total?: number;
  errorCode?: string;
}

const architectures: AppArchitecture[] = ['amd64', 'arm64', 'armv7', 'i386'];
const optionTypes = ['string', 'number', 'boolean', 'select', 'list'] as const;
const VALID_NETWORK_MODES = ['bridge', 'host', 'internal', 'none'] as const;
const VALID_MOUNT_TARGETS = ['data', 'media', 'share', 'backup', 'config'] as const;
const VALID_DEVICE_TYPES = ['gpu', 'video', 'serial', 'usb'] as const;

function parseOptions(raw: unknown): AppOptionSchema[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed: AppOptionSchema[] = [];
  for (const item of raw) {
    if (!record(item) || typeof item.name !== 'string' || typeof item.type !== 'string') continue;
    if (!optionTypes.includes(item.type as AppOptionSchema['type'])) continue;
    const choices = Array.isArray(item.choices)
      ? item.choices.filter(
          (c): c is string | number => typeof c === 'string' || typeof c === 'number',
        )
      : undefined;
    parsed.push({
      name: item.name,
      type: item.type as AppOptionSchema['type'],
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(typeof item.required === 'boolean' ? { required: item.required } : {}),
      ...(item.default !== undefined ? { default: item.default } : {}),
      ...(choices ? { choices } : {}),
    });
  }
  return parsed;
}

function parseSecrets(raw: unknown): AppSecretDeclaration[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed: AppSecretDeclaration[] = [];
  for (const item of raw) {
    if (!record(item) || typeof item.name !== 'string') continue;
    parsed.push({
      name: item.name,
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(typeof item.required === 'boolean' ? { required: item.required } : {}),
    });
  }
  return parsed;
}

function parseMounts(raw: unknown): AppMount[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: AppMount[] = [];
  for (const item of raw) {
    if (
      !record(item) ||
      typeof item.target !== 'string' ||
      !VALID_MOUNT_TARGETS.includes(item.target as AppMount['target']) ||
      typeof item.containerPath !== 'string'
    )
      continue;
    result.push({
      target: item.target as AppMount['target'],
      containerPath: item.containerPath,
      ...(typeof item.readOnly === 'boolean' ? { readOnly: item.readOnly } : {}),
    });
  }
  return result;
}

function parsePorts(raw: unknown): AppPortMapping[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: AppPortMapping[] = [];
  for (const item of raw) {
    if (!record(item) || typeof item.containerPort !== 'number') continue;
    result.push({
      containerPort: item.containerPort,
      ...(typeof item.hostPort === 'number' ? { hostPort: item.hostPort } : {}),
      ...(item.protocol === 'tcp' || item.protocol === 'udp' ? { protocol: item.protocol } : {}),
      ...(typeof item.ingressOnly === 'boolean' ? { ingressOnly: item.ingressOnly } : {}),
    });
  }
  return result;
}

function parseDevices(raw: unknown): AppDevice[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: AppDevice[] = [];
  for (const item of raw) {
    if (
      !record(item) ||
      typeof item.type !== 'string' ||
      !VALID_DEVICE_TYPES.includes(item.type as AppDevice['type']) ||
      typeof item.hostPath !== 'string'
    )
      continue;
    result.push({
      type: item.type as AppDevice['type'],
      hostPath: item.hostPath,
      ...(typeof item.containerPath === 'string' ? { containerPath: item.containerPath } : {}),
    });
  }
  return result;
}

function parseEnv(raw: unknown): AppManifest['env'] | undefined {
  if (Array.isArray(raw) && raw.every((item): item is string => typeof item === 'string')) {
    return raw;
  }
  if (record(raw)) {
    const entries = Object.entries(raw).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    return Object.fromEntries(entries);
  }
  return undefined;
}

function parseManifest(raw: unknown): AppManifest {
  if (
    !record(raw) ||
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    typeof raw.version !== 'string' ||
    typeof raw.image !== 'string'
  ) {
    throw Error('The Hub returned an invalid App manifest.');
  }
  const archs = Array.isArray(raw.architectures)
    ? raw.architectures.filter(
        (a): a is AppArchitecture =>
          typeof a === 'string' && architectures.includes(a as AppArchitecture),
      )
    : [];
  const options = parseOptions(raw.options);
  const secrets = parseSecrets(raw.secrets);
  const mounts = parseMounts(raw.mounts);
  const ports = parsePorts(raw.ports);
  const devices = parseDevices(raw.devices);
  const env = parseEnv(raw.env);
  const cmd =
    Array.isArray(raw.cmd) && raw.cmd.every((item): item is string => typeof item === 'string')
      ? raw.cmd
      : undefined;
  const dependencies =
    Array.isArray(raw.dependencies) &&
    raw.dependencies.every((item): item is string => typeof item === 'string')
      ? raw.dependencies
      : undefined;
  const network: AppNetwork | undefined =
    record(raw.network) &&
    typeof raw.network.mode === 'string' &&
    VALID_NETWORK_MODES.includes(raw.network.mode as AppNetwork['mode'])
      ? { mode: raw.network.mode as AppNetwork['mode'] }
      : undefined;
  const ingress: AppManifest['ingress'] | undefined =
    record(raw.ingress) &&
    typeof raw.ingress.enabled === 'boolean' &&
    typeof raw.ingress.port === 'number'
      ? {
          enabled: raw.ingress.enabled,
          port: raw.ingress.port,
          ...(typeof raw.ingress.slug === 'string' ? { slug: raw.ingress.slug } : {}),
          ...(typeof raw.ingress.title === 'string' ? { title: raw.ingress.title } : {}),
          ...(typeof raw.ingress.websocket === 'boolean'
            ? { websocket: raw.ingress.websocket }
            : {}),
        }
      : undefined;
  const build: AppManifest['build'] | undefined =
    record(raw.build) &&
    typeof raw.build.repository === 'string' &&
    typeof raw.build.commit === 'string'
      ? {
          repository: raw.build.repository,
          commit: raw.build.commit,
          ...(typeof raw.build.context === 'string' ? { context: raw.build.context } : {}),
          ...(typeof raw.build.dockerfile === 'string' ? { dockerfile: raw.build.dockerfile } : {}),
        }
      : undefined;
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    image: raw.image,
    architectures: archs.length > 0 ? archs : ['amd64', 'arm64'],
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(options ? { options } : {}),
    ...(secrets ? { secrets } : {}),
    ...(mounts ? { mounts } : {}),
    ...(ports ? { ports } : {}),
    ...(devices ? { devices } : {}),
    ...(network ? { network } : {}),
    ...(ingress ? { ingress } : {}),
    ...(build ? { build } : {}),
    ...(dependencies ? { dependencies } : {}),
    ...(env ? { env } : {}),
    ...(cmd ? { cmd } : {}),
  };
}

export function parseCatalog(value: unknown): CatalogAppSummary[] {
  if (!record(value) || !Array.isArray(value.entries))
    throw Error('The Hub returned an invalid App catalog.');
  return value.entries.map((item): CatalogAppSummary => {
    if (!record(item) || typeof item.id !== 'string' || typeof item.name !== 'string')
      throw Error('The Hub returned an invalid catalog entry.');
    return {
      id: item.id,
      name: item.name,
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      category: typeof item.category === 'string' ? item.category : 'utility',
      runtimeType: typeof item.runtimeType === 'string' ? item.runtimeType : 'docker',
      channel: typeof item.channel === 'string' ? item.channel : 'stable',
      featured: item.featured === true,
      ...(typeof item.documentationUrl === 'string'
        ? { documentationUrl: item.documentationUrl }
        : {}),
      ...(typeof item.repositoryUrl === 'string' ? { repositoryUrl: item.repositoryUrl } : {}),
      ...(typeof item.author === 'string' ? { author: item.author } : {}),
      installed: item.installed === true,
      ...(typeof item.state === 'string' ? { state: item.state } : {}),
      ...(typeof item.currentVersion === 'string' ? { currentVersion: item.currentVersion } : {}),
      latestVersion: typeof item.latestVersion === 'string' ? item.latestVersion : 'latest',
      updateAvailable: item.updateAvailable === true,
      ...(typeof item.releaseNotes === 'string' ? { releaseNotes: item.releaseNotes } : {}),
    };
  });
}

export function parseCatalogDetail(value: unknown): CatalogAppDetail {
  if (!record(value) || !record(value.entry))
    throw Error('The Hub returned an invalid catalog entry.');
  const entry = value.entry;
  return {
    manifest: parseManifest(entry.manifest),
    category: typeof entry.category === 'string' ? entry.category : 'utility',
    runtimeType: typeof entry.runtimeType === 'string' ? entry.runtimeType : 'docker',
    ...(typeof entry.author === 'string' ? { author: entry.author } : {}),
    ...(typeof entry.documentationUrl === 'string'
      ? { documentationUrl: entry.documentationUrl }
      : {}),
    ...(typeof entry.repositoryUrl === 'string' ? { repositoryUrl: entry.repositoryUrl } : {}),
  };
}

export function requiredManifestPermissions(
  manifest: Pick<AppManifest, 'mounts' | 'network' | 'ports' | 'devices' | 'ingress'>,
): AppPermissionType[] {
  const perms = new Set<AppPermissionType>();
  for (const mount of manifest.mounts ?? []) {
    if (mount.target === 'media') perms.add('mount:media');
    else if (mount.target === 'share') perms.add('mount:share');
    else if (mount.target === 'backup') perms.add('mount:backup');
    else if (mount.target === 'config') perms.add('mount:config');
  }
  if (manifest.network?.mode === 'host') perms.add('network:host');
  for (const port of manifest.ports ?? []) {
    if (port.hostPort !== undefined && port.hostPort > 0 && port.hostPort < 1024) {
      perms.add('port:privileged');
    }
  }
  for (const device of manifest.devices ?? []) {
    if (device.type === 'gpu') perms.add('device:gpu');
    else if (device.type === 'video') perms.add('device:video');
    else if (device.type === 'serial') perms.add('device:serial');
    else if (device.type === 'usb') perms.add('device:usb');
  }
  if (manifest.ingress?.enabled) perms.add('ingress');
  return Array.from(perms);
}

export function parseUpdateCheck(value: unknown): AppUpdateStatus {
  if (!record(value) || typeof value.updateAvailable !== 'boolean')
    throw Error('The Hub returned an invalid update check result.');
  const targetManifest = record(value.targetManifest)
    ? parseManifest(value.targetManifest)
    : undefined;
  return {
    updateAvailable: value.updateAvailable,
    currentVersion: typeof value.currentVersion === 'string' ? value.currentVersion : 'unknown',
    ...(typeof value.latestVersion === 'string' ? { latestVersion: value.latestVersion } : {}),
    ...(typeof value.releaseNotes === 'string' ? { releaseNotes: value.releaseNotes } : {}),
    requiredPermissions: targetManifest ? requiredManifestPermissions(targetManifest) : [],
  };
}

export function parseInstallProgress(value: unknown): AppInstallProgress | undefined {
  if (!record(value) || typeof value.stage !== 'string') return undefined;
  return {
    appId: typeof value.appId === 'string' ? value.appId : '',
    stage: value.stage,
    ...(typeof value.current === 'number' ? { current: value.current } : {}),
    ...(typeof value.total === 'number' ? { total: value.total } : {}),
    ...(typeof value.errorCode === 'string' ? { errorCode: value.errorCode } : {}),
  };
}

export function initialConfigFromManifest(
  manifest?: Pick<AppManifest, 'options'>,
): Record<string, unknown> {
  const initial: Record<string, unknown> = {};
  for (const opt of manifest?.options ?? []) {
    if (opt.default !== undefined) {
      initial[opt.name] = opt.default;
    } else if (opt.type === 'boolean') {
      initial[opt.name] = false;
    } else {
      initial[opt.name] = '';
    }
  }
  return initial;
}

export function sanitizeOptionsSubmission(
  manifest: Pick<AppManifest, 'options' | 'secrets'> | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (!manifest) return { ...values };
  const result: Record<string, unknown> = {};
  for (const opt of manifest.options ?? []) {
    if (!(opt.name in values)) continue;
    const raw = values[opt.name];
    if (opt.type === 'boolean') {
      result[opt.name] = raw === true;
    } else if (opt.type === 'number') {
      const numeric = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(numeric)) result[opt.name] = numeric;
    } else if (opt.type === 'list') {
      if (Array.isArray(raw)) {
        result[opt.name] = raw.map((v) => String(v).trim()).filter(Boolean);
      } else if (typeof raw === 'string' && raw.trim().length > 0) {
        result[opt.name] = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } else if (typeof raw === 'string' || typeof raw === 'number') {
      const text = String(raw).trim();
      if (text.length > 0) result[opt.name] = text;
    }
  }
  for (const secret of manifest.secrets ?? []) {
    const raw = values[secret.name];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      result[secret.name] = raw;
    }
  }
  return result;
}
