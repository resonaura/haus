import { HACS_COMMANDS, validateHacsRequest } from './hacs-validation';
import { isIP } from 'node:net';

/** Allow cleartext only for local Home Assistant installations. Never accept URL credentials. */
export function normalizeServerUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048) {
    throw new Error('Enter a valid Home Assistant URL.');
  }
  const candidate = input.trim();
  let url: URL;
  try {
    url = new URL(candidate.includes('://') ? candidate : `http://${candidate}`);
  } catch {
    throw new Error('Enter a valid Home Assistant URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Use the Home Assistant base URL without credentials, a path, or query.');
  }
  if (url.protocol === 'http:' && !isLocalHostname(url.hostname)) {
    throw new Error('Use HTTPS for Home Assistant outside your local network.');
  }
  return url.origin;
}

export function isLocalHostname(value: string): boolean {
  const host = value
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (isIP(host) === 4) {
    const octets = host.split('.').map(Number);
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    );
  }
  if (isIP(host) === 6) return host === '::1' || /^(fc|fd|fe[89ab])/.test(host);
  return /^[a-z0-9][a-z0-9-]*$/.test(host) || host.endsWith('.lan') || host.endsWith('.home.arpa');
}

const REQUEST_TYPES = new Set([
  ...HACS_COMMANDS,
  'get_states',
  'search/related',
  'get_services',
  'get_config',
  'persistent_notification/get',
  'persistent_notification/subscribe',
  'repairs/list_issues',
  'config_entries/get',
  'config_entries/get_single',
  'config_entries/update',
  'config_entries/disable',
  'config_entries/flow/progress',
  'config_entries/ignore_flow',
  'manifest/list',
  'manifest/get',
  'frontend/get_translations',
  'hassio/update/addon',
  'supervisor/api',
  'auth/current_user',
  'recorder/list_statistic_ids',
  'recorder/statistics_during_period',
  'history/history_during_period',
  'call_service',
  'config/area_registry/list',
  'config/area_registry/create',
  'config/area_registry/update',
  'config/area_registry/delete',
  'config/device_registry/list',
  'config/device_registry/update',
  'config/entity_registry/list',
  'config/entity_registry/get',
  'config/entity_registry/update',
  'config/floor_registry/list',
  'config/label_registry/list',
  'lovelace/dashboards/list',
  'lovelace/dashboards/create',
  'lovelace/dashboards/update',
  'lovelace/config',
  'lovelace/config/save',
  'automation/config',
  'script/config',
  'camera/capabilities',
  'generic_camera/start_preview',
  'camera/stream',
  'camera/web_rtc_offer',
  'camera/webrtc/get_client_config',
  'camera/webrtc/offer',
  'camera/webrtc/candidate',
]);

export function validateRequest(input: unknown): Record<string, unknown> {
  if (!isRecord(input) || typeof input.type !== 'string' || !REQUEST_TYPES.has(input.type)) {
    throw new Error('This Home Assistant command is not available in Haus.');
  }
  if (input.type.startsWith('hacs/')) validateHacsRequest(input);
  if ('id' in input || 'access_token' in input || 'refresh_token' in input) {
    throw new Error('Native transport owns command identifiers and authentication.');
  }
  if (
    input.type === 'generic_camera/start_preview' &&
    (typeof input.flow_id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.flow_id) ||
      Object.keys(input).some((key) => !['type', 'flow_id'].includes(key)))
  )
    throw new Error('Choose a valid camera setup preview.');
  if (
    input.type === 'search/related' &&
    (!['device', 'entity'].includes(String(input.item_type)) ||
      typeof input.item_id !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,128}$/.test(input.item_id))
  )
    throw new Error('Choose a valid device or entity.');
  if (
    input.type === 'history/history_during_period' &&
    (!Array.isArray(input.entity_ids) ||
      !input.entity_ids.length ||
      input.entity_ids.length > 96 ||
      input.entity_ids.some(
        (id) =>
          typeof id !== 'string' ||
          !/^(light|sensor|binary_sensor|switch|cover|climate|fan|lock|media_player)\.[a-z0-9_]+$/.test(
            id,
          ),
      ) ||
      typeof input.start_time !== 'string' ||
      !Number.isFinite(Date.parse(input.start_time)) ||
      (input.end_time !== undefined &&
        (typeof input.end_time !== 'string' ||
          !Number.isFinite(Date.parse(input.end_time)) ||
          Date.parse(input.end_time) <= Date.parse(input.start_time) ||
          Date.parse(input.end_time) - Date.parse(input.start_time) > 7 * 86400000)))
  )
    throw new Error('Select devices and a valid history period.');
  if (
    input.type === 'supervisor/api' &&
    !(
      (['/addons', '/store', '/store/repositories'].includes(String(input.endpoint)) &&
        input.method === 'get' &&
        !('data' in input)) ||
      (typeof input.endpoint === 'string' &&
        /^\/store\/addons\/[a-zA-Z0-9_-]+$/.test(input.endpoint) &&
        input.method === 'get' &&
        !('data' in input)) ||
      (typeof input.endpoint === 'string' &&
        /^\/store\/addons\/[a-zA-Z0-9_-]+\/(install|update)$/.test(input.endpoint) &&
        input.method === 'post' &&
        !('data' in input)) ||
      (input.endpoint === '/store/reload' && input.method === 'post' && !('data' in input)) ||
      (input.endpoint === '/store/repositories' &&
        input.method === 'post' &&
        isRecord(input.data) &&
        typeof input.data.repository === 'string' &&
        input.data.repository.startsWith('https://')) ||
      (typeof input.endpoint === 'string' &&
        /^\/store\/repositories\/[a-zA-Z0-9_-]+$/.test(input.endpoint) &&
        input.method === 'delete' &&
        !('data' in input)) ||
      (typeof input.endpoint === 'string' &&
        /^\/addons\/[a-zA-Z0-9_-]+\/(info|stats)$/.test(input.endpoint) &&
        input.method === 'get' &&
        !('data' in input)) ||
      (typeof input.endpoint === 'string' &&
        /^\/addons\/[a-zA-Z0-9_-]+\/(start|stop|restart|install|rebuild)$/.test(input.endpoint) &&
        input.method === 'post' &&
        !('data' in input)) ||
      (typeof input.endpoint === 'string' &&
        /^\/addons\/[a-zA-Z0-9_-]+\/(options|options\/validate)$/.test(input.endpoint) &&
        input.method === 'post' &&
        isRecord(input.data)) ||
      (typeof input.endpoint === 'string' &&
        /^\/addons\/[a-zA-Z0-9_-]+\/uninstall$/.test(input.endpoint) &&
        input.method === 'post' &&
        isRecord(input.data) &&
        Object.keys(input.data).every((key) => key === 'remove_config') &&
        typeof input.data.remove_config === 'boolean')
    )
  ) {
    throw new Error('This Supervisor operation is not available in Haus.');
  }
  if (JSON.stringify(input).length > 256_000)
    throw new Error('Home Assistant command is too large.');
  return input;
}

export function validateManagement(input: unknown): {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  data?: Record<string, unknown>;
} {
  if (
    !isRecord(input) ||
    !['GET', 'POST', 'DELETE'].includes(String(input.method)) ||
    typeof input.path !== 'string' ||
    JSON.stringify(input).length > 256_000
  )
    throw new Error('Invalid management request.');
  const { method, path, data } = input;
  if (data !== undefined && (!isRecord(data) || method !== 'POST'))
    throw new Error('Invalid management form.');
  const flow = /^config\/config_entries\/(?:options\/)?flow(?:\/[a-zA-Z0-9_-]+)?$/.test(path);
  const entry = /^config\/config_entries\/entry\/[a-zA-Z0-9_-]+(?:\/reload)?$/.test(path);
  const editableConfig = /^config\/(scene|automation|script)\/config\/[a-z0-9_-]{1,128}$/i.test(
    path,
  );
  const valid =
    editableConfig ||
    (/^repairs\/issues\/fix(?:\/[a-zA-Z0-9_-]+)?$/.test(path) &&
      (method !== 'DELETE' || path !== 'repairs/issues/fix')) ||
    (flow && (method !== 'DELETE' || /\/flow\//.test(path))) ||
    (entry &&
      ((method === 'POST' && path.endsWith('/reload')) ||
        (method === 'DELETE' && !path.endsWith('/reload')))) ||
    (method === 'GET' && path === 'config/config_entries/flow_handlers') ||
    (method === 'GET' && /^diagnostics\/config_entry\/[a-zA-Z0-9_-]+$/.test(path)) ||
    (method === 'GET' &&
      /^hassio\/addons\/[a-zA-Z0-9_-]+\/(logs|documentation|changelog)$/.test(path));
  if (!valid) throw new Error('This management operation is not available in Haus.');
  return {
    method: method as 'GET' | 'POST' | 'DELETE',
    path,
    ...(data !== undefined ? { data } : {}),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validatePreferences(input: unknown): Record<string, unknown> {
  if (!isRecord(input) || JSON.stringify(input).length > 100_000) {
    throw new Error('Invalid preferences.');
  }
  if (Object.keys(input).some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw new Error('Invalid preference key.');
  }
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

export function validateExternalUrl(input: unknown, serverUrl?: string): string {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Invalid external URL.');
  const url = new URL(input);
  const documentationHosts = new Set([
    'github.com',
    'www.home-assistant.io',
    'home-assistant.io',
    'developers.home-assistant.io',
    'www.nabucasa.com',
    'www.electronjs.org',
  ]);
  const sameServer = serverUrl && url.origin === new URL(serverUrl).origin;
  if (
    url.username ||
    url.password ||
    !['http:', 'https:'].includes(url.protocol) ||
    (!sameServer && !(url.protocol === 'https:' && documentationHosts.has(url.hostname)))
  ) {
    throw new Error('Haus can only open your Home Assistant or supported documentation links.');
  }
  return url.href;
}
