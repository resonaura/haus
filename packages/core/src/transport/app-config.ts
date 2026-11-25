/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export const REDACTED_SECRET_PLACEHOLDER = '<unchanged>';

const SECRET_KEY_RE = /^(?:.*[_-])?(?:pass(?:word)?|secret|token|api_?key)$/i;

function isRec(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface AddonRepositorySummary {
  readonly id: string;
  readonly url: string;
  readonly branch?: string;
  readonly name: string;
  readonly maintainer?: string;
  readonly infoUrl?: string;
  readonly addonIds: readonly string[];
  readonly updatedAt: string;
}

export function parseAddonRepositories(raw: unknown): AddonRepositorySummary[] {
  if (!isRec(raw) || !Array.isArray(raw.repositories)) return [];
  const out: AddonRepositorySummary[] = [];
  for (const item of raw.repositories) {
    if (!isRec(item) || typeof item.id !== 'string' || typeof item.url !== 'string') continue;
    const addonIds = Array.isArray(item.addonIds)
      ? item.addonIds.filter((v): v is string => typeof v === 'string')
      : [];
    out.push({
      id: item.id,
      url: item.url,
      ...(typeof item.branch === 'string' ? { branch: item.branch } : {}),
      name: typeof item.name === 'string' && item.name ? item.name : item.url,
      ...(typeof item.maintainer === 'string' ? { maintainer: item.maintainer } : {}),
      ...(typeof item.infoUrl === 'string' ? { infoUrl: item.infoUrl } : {}),
      addonIds,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
    });
  }
  return out;
}

export function formatAddonRepositoryError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (raw.includes('addon_repository_is_hacs_repo')) {
    return 'This is a HACS integration repository, not a Home Assistant Add-on repository. Add it under Integrations → Custom repository or Community (HACS).';
  }
  if (raw.includes('invalid_addon_repository_missing_repository_yaml')) {
    return 'Not a valid Home Assistant Add-on repository: root repository.yaml or repository.json was not found.';
  }
  if (raw.includes('addon_repository_already_exists')) {
    return 'This add-on repository is already added.';
  }
  if (raw.includes('addon_repository_in_use:')) {
    const slugs = raw.split('addon_repository_in_use:')[1]?.trim() ?? '';
    return `Cannot remove this repository while its add-ons are installed (${slugs}). Uninstall them first.`;
  }
  if (
    raw.includes('unsupported_addon_repository_host') ||
    raw.includes('invalid_addon_repository_url')
  ) {
    return 'Enter a valid GitHub repository URL (e.g. https://github.com/owner/repository or https://github.com/owner/repository#branch).';
  }
  if (raw.includes('addon_repository_not_found')) {
    return 'Repository was not found on GitHub. Check the URL and ensure the repository is public.';
  }
  if (raw.includes('github_rate_limited')) {
    return 'GitHub API rate limit reached. Please wait a minute and try again.';
  }
  return raw || 'Could not update custom add-on repositories.';
}

export interface NativeConfigFieldMeta {
  readonly title?: string;
  readonly description?: string;
  readonly type?: 'string' | 'number' | 'boolean' | 'select' | 'object' | 'array';
  readonly secret?: boolean;
  readonly choices?: readonly (string | number)[];
}

export interface LoadedAppConfigInfo {
  readonly config: Record<string, unknown>;
  readonly configuredSecrets: readonly string[];
  readonly nativeFields?: Readonly<Record<string, NativeConfigFieldMeta>>;
  readonly image?: string;
}

export function isSecretConfigKey(key: string, meta?: NativeConfigFieldMeta): boolean {
  return meta?.secret === true || SECRET_KEY_RE.test(key);
}

export function isGoveeAddon(externalId: string, image?: string): boolean {
  return (
    externalId === 'govee' ||
    externalId === 'homebridge-govee' ||
    externalId === 'govee2mqtt' ||
    /govee/i.test(image ?? '')
  );
}

function parseNativeFields(raw: unknown): Record<string, NativeConfigFieldMeta> | undefined {
  if (!isRec(raw)) return undefined;
  const out: Record<string, NativeConfigFieldMeta> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRec(value)) continue;
    const choices = Array.isArray(value.choices)
      ? value.choices.filter(
          (item): item is string | number => typeof item === 'string' || typeof item === 'number',
        )
      : undefined;
    const type =
      value.type === 'string' ||
      value.type === 'number' ||
      value.type === 'boolean' ||
      value.type === 'select' ||
      value.type === 'object' ||
      value.type === 'array'
        ? value.type
        : undefined;
    out[key] = {
      ...(typeof value.title === 'string' ? { title: value.title } : {}),
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
      ...(type ? { type } : {}),
      ...(typeof value.secret === 'boolean' ? { secret: value.secret } : {}),
      ...(choices ? { choices } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseAppConfigInfo(raw: unknown): LoadedAppConfigInfo | undefined {
  if (!isRec(raw) || raw.status !== 'ok' || !isRec(raw.data)) return undefined;
  const data = raw.data;
  const config = isRec(data.config) ? { ...data.config } : {};
  const configuredSecrets = Array.isArray(data.configuredSecrets)
    ? data.configuredSecrets.filter((item): item is string => typeof item === 'string')
    : [];
  const nativeFields = parseNativeFields(data.nativeFields);
  const image =
    isRec(data.manifest) && typeof data.manifest.image === 'string'
      ? data.manifest.image
      : undefined;
  return {
    config,
    configuredSecrets,
    ...(nativeFields ? { nativeFields } : {}),
    ...(image ? { image } : {}),
  };
}

function extractManifest(payload: unknown): Record<string, unknown> | undefined {
  if (!isRec(payload)) return undefined;
  if (isRec(payload.entry) && isRec(payload.entry.manifest)) return payload.entry.manifest;
  if (isRec(payload.manifest)) return payload.manifest;
  return undefined;
}

export function mergeCatalogFieldMeta(
  base: Readonly<Record<string, NativeConfigFieldMeta>> | undefined,
  catalogDetailPayload: unknown,
): Record<string, NativeConfigFieldMeta> {
  const merged: Record<string, NativeConfigFieldMeta> = { ...base };
  const manifest = extractManifest(catalogDetailPayload);
  if (!manifest) return merged;

  if (Array.isArray(manifest.options)) {
    for (const opt of manifest.options) {
      if (!isRec(opt) || typeof opt.name !== 'string' || merged[opt.name]) continue;
      const choices = Array.isArray(opt.choices)
        ? opt.choices.filter(
            (item): item is string | number => typeof item === 'string' || typeof item === 'number',
          )
        : undefined;
      merged[opt.name] = {
        ...(typeof opt.description === 'string' ? { description: opt.description } : {}),
        ...(choices ? { choices } : {}),
      };
    }
  }
  if (Array.isArray(manifest.secrets)) {
    for (const sec of manifest.secrets) {
      if (!isRec(sec) || typeof sec.name !== 'string' || merged[sec.name]) continue;
      merged[sec.name] = {
        ...(typeof sec.description === 'string' ? { description: sec.description } : {}),
        secret: true,
      };
    }
  }
  return merged;
}

export function parseCatalogInstallPayload(catalogDetailPayload: unknown):
  | {
      readonly manifest: Record<string, unknown>;
      readonly grantedPermissions: readonly string[];
    }
  | undefined {
  const manifest = extractManifest(catalogDetailPayload);
  if (!manifest || typeof manifest.id !== 'string') return undefined;

  const granted = new Set<string>();
  if (Array.isArray(manifest.mounts)) {
    for (const mount of manifest.mounts) {
      if (!isRec(mount) || typeof mount.target !== 'string') continue;
      if (
        mount.target === 'media' ||
        mount.target === 'share' ||
        mount.target === 'backup' ||
        mount.target === 'config'
      ) {
        granted.add(`mount:${mount.target}`);
      }
    }
  }
  if (isRec(manifest.network) && manifest.network.mode === 'host') {
    granted.add('network:host');
  }
  if (Array.isArray(manifest.ports)) {
    for (const port of manifest.ports) {
      if (
        isRec(port) &&
        typeof port.hostPort === 'number' &&
        port.hostPort > 0 &&
        port.hostPort < 1024
      ) {
        granted.add('port:privileged');
      }
    }
  }
  if (Array.isArray(manifest.devices)) {
    for (const device of manifest.devices) {
      if (!isRec(device) || typeof device.type !== 'string') continue;
      if (
        device.type === 'gpu' ||
        device.type === 'video' ||
        device.type === 'serial' ||
        device.type === 'usb'
      ) {
        granted.add(`device:${device.type}`);
      }
    }
  }
  if (isRec(manifest.ingress) && manifest.ingress.enabled === true) {
    granted.add('ingress');
  }
  if (Array.isArray(manifest.permissions)) {
    for (const item of manifest.permissions) {
      if (typeof item === 'string' && item) {
        granted.add(item);
      } else if (
        isRec(item) &&
        typeof item.type === 'string' &&
        item.type &&
        item.optional !== true
      ) {
        granted.add(item.type);
      }
    }
  }

  return {
    manifest: { ...manifest },
    grantedPermissions: [...granted],
  };
}

export function parseConfigJsonObject(
  text: string,
):
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Configuration must be valid JSON.' };
  }
  if (!isRec(parsed)) {
    return { ok: false, error: 'Configuration must be a JSON object.' };
  }
  return { ok: true, value: parsed };
}

export function buildDemoAppRepositories(): AddonRepositorySummary[] {
  return [
    {
      id: '9f3c1e2a',
      url: 'https://github.com/haus-home/community-addons#main',
      branch: 'main',
      name: 'Haus Community Add-ons',
      maintainer: 'Haus Maintainers',
      infoUrl: 'https://github.com/haus-home/community-addons',
      addonIds: ['9f3c1e2a-thread-border'],
      updatedAt: '2026-11-24T00:00:00.000Z',
    },
  ];
}

export function buildDemoAppConfig(appId: string): LoadedAppConfigInfo {
  if (appId === 'zigbee2mqtt') {
    return {
      config: {
        serial_port: '/dev/ttyACM0',
        channel: 20,
        permit_join: false,
        log_level: 'info',
        mqtt_password: REDACTED_SECRET_PLACEHOLDER,
        advanced: { pan_id: 6754 },
      },
      configuredSecrets: ['mqtt_password'],
      nativeFields: {
        serial_port: {
          title: 'Coordinator device',
          description: 'Serial device path or tcp:// endpoint',
        },
        channel: { title: 'Zigbee channel', type: 'number', description: 'Radio channel (11–26)' },
        permit_join: {
          title: 'Permit joining',
          type: 'boolean',
          description: 'Allow new Zigbee pairings',
        },
        log_level: {
          title: 'Log level',
          type: 'select',
          choices: ['debug', 'info', 'warn', 'error'],
        },
        mqtt_password: {
          title: 'MQTT password',
          secret: true,
          description: 'Leave empty to preserve current broker secret.',
        },
        advanced: { title: 'Advanced options', type: 'object' },
      },
    };
  }
  if (appId === 'go2rtc') {
    return {
      config: {
        rtsp_port: 8554,
        webrtc_enabled: true,
        api_token: REDACTED_SECRET_PLACEHOLDER,
      },
      configuredSecrets: ['api_token'],
      nativeFields: {
        rtsp_port: { title: 'RTSP port', type: 'number' },
        webrtc_enabled: { title: 'Enable WebRTC relay', type: 'boolean' },
        api_token: { title: 'Relay API token', secret: true },
      },
    };
  }
  return {
    config: {
      backbone_interface: 'eth0',
      nat64: true,
    },
    configuredSecrets: [],
    nativeFields: {
      backbone_interface: { title: 'Backbone interface' },
      nat64: { title: 'Enable NAT64 translation', type: 'boolean' },
    },
  };
}
