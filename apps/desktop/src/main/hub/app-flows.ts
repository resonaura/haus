/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { isRecord } from './types';

export type HubApiCaller = (
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<unknown>;

interface CatalogManifestField {
  readonly name: string;
  readonly type?: 'string' | 'number' | 'boolean' | 'select';
  readonly required?: boolean;
  readonly default?: unknown;
  readonly description?: string;
  readonly choices?: readonly string[];
}

interface CatalogSecretField {
  readonly name: string;
  readonly required?: boolean;
  readonly description?: string;
}

interface CatalogManifestShape {
  readonly id: string;
  readonly name?: string;
  readonly options?: readonly CatalogManifestField[];
  readonly secrets?: readonly CatalogSecretField[];
}

export interface AppFlowSession {
  readonly kind: 'app';
  readonly mode: 'config' | 'options';
  readonly appId: string;
  readonly manifest: CatalogManifestShape;
}

const APP_FLOW_DOMAINS = new Set([
  'govee',
  'homebridge-govee',
  'homebridge-appletv-enhanced',
  'aqara-cameras',
  'govee2mqtt',
  'matter-server',
  'tuya-rtsp-bridge',
]);

const APP_FLOW_TITLES: Record<string, string> = {
  govee: 'Govee',
  'homebridge-govee': 'Homebridge Govee',
  'homebridge-appletv-enhanced': 'Apple TV Enhanced',
  'aqara-cameras': 'Aqara Camera Bridge',
  govee2mqtt: 'Govee to MQTT',
  'matter-server': 'Matter Server',
  'tuya-rtsp-bridge': 'Tuya Camera Bridge',
};

export function normalizeAppFlowDomain(rawHandler: string): string {
  const trimmed = rawHandler.trim();
  return trimmed.startsWith('app:') ? trimmed.slice(4) : trimmed;
}

export function isAppFlowDomain(rawHandler: string): boolean {
  return APP_FLOW_DOMAINS.has(normalizeAppFlowDomain(rawHandler));
}

export function isAppConfigEntryId(entryId: string): boolean {
  return entryId.startsWith('app:') && entryId.length > 4;
}

function optionToFormField(opt: CatalogManifestField): Record<string, unknown> {
  if (opt.type === 'boolean') {
    return {
      name: opt.name,
      type: 'boolean',
      required: Boolean(opt.required),
      default: opt.default ?? false,
      selector: { boolean: {} },
    };
  }
  if (opt.type === 'number') {
    return {
      name: opt.name,
      type: 'number',
      required: Boolean(opt.required),
      ...(opt.default !== undefined ? { default: opt.default } : {}),
      selector: { number: {} },
    };
  }
  if (opt.type === 'select') {
    return {
      name: opt.name,
      type: 'select',
      required: Boolean(opt.required),
      ...(opt.default !== undefined ? { default: opt.default } : {}),
      selector: { select: { options: [...(opt.choices ?? [])] } },
    };
  }
  return {
    name: opt.name,
    type: 'string',
    required: Boolean(opt.required),
    default: opt.default ?? '',
    selector: { text: {} },
  };
}

function buildAppFormSchema(
  manifest: CatalogManifestShape,
  mode: 'config' | 'options',
): Array<Record<string, unknown>> {
  const fields: Array<Record<string, unknown>> = [];
  const options = manifest.options ?? [];
  const secrets = manifest.secrets ?? [];
  const usernameOption = options.find((opt) => opt.name === 'username');
  if (usernameOption) fields.push(optionToFormField(usernameOption));
  for (const secret of secrets) {
    fields.push({
      name: secret.name,
      type: 'string',
      required: mode === 'config' ? Boolean(secret.required) : false,
      default: '',
      selector: { password: {} },
    });
  }
  for (const opt of options) {
    if (opt.name === 'username') continue;
    fields.push(optionToFormField(opt));
  }
  return fields;
}

export function sanitizeAppConfig(
  manifest: CatalogManifestShape,
  submitted: Record<string, unknown>,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const opt of manifest.options ?? []) {
    if (!(opt.name in submitted)) continue;
    const raw = submitted[opt.name];
    if (opt.type === 'boolean') {
      if (typeof raw === 'boolean') config[opt.name] = raw;
    } else if (opt.type === 'number') {
      if (typeof raw === 'number' && Number.isFinite(raw)) config[opt.name] = raw;
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length > 0) config[opt.name] = trimmed;
    }
  }
  for (const secret of manifest.secrets ?? []) {
    const raw = submitted[secret.name];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      config[secret.name] = raw;
    }
  }
  return config;
}

export async function startAppConfigFlow(
  api: HubApiCaller,
  rawHandler: string,
  flowId: string,
  mode: 'config' | 'options',
): Promise<{ session: AppFlowSession; step: Record<string, unknown> }> {
  const appId = normalizeAppFlowDomain(rawHandler);
  const catalogResponse = await api(`/api/apps/catalog/${encodeURIComponent(appId)}`);
  const entry =
    isRecord(catalogResponse) && isRecord(catalogResponse.entry) ? catalogResponse.entry : null;
  const manifest =
    entry && isRecord(entry.manifest) && typeof entry.manifest.id === 'string'
      ? (entry.manifest as unknown as CatalogManifestShape)
      : null;
  if (!manifest) {
    throw new Error(`Catalog manifest for ${appId} is unavailable on the Hub.`);
  }
  const session: AppFlowSession = { kind: 'app', mode, appId, manifest };
  return {
    session,
    step: {
      type: 'form',
      flow_id: flowId,
      handler: appId,
      step_id: 'user',
      title: manifest.name || appId,
      last_step: true,
      data_schema: buildAppFormSchema(manifest, mode),
    },
  };
}

export async function submitAppConfigFlow(
  api: HubApiCaller,
  flowId: string,
  session: AppFlowSession,
  submitted: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config = sanitizeAppConfig(session.manifest, submitted);
  const inventory = await api('/api/apps').catch(() => null);
  const installed =
    isRecord(inventory) &&
    Array.isArray(inventory.apps) &&
    inventory.apps.some(
      (item) =>
        isRecord(item) &&
        (item.id === session.appId ||
          (isRecord(item.source) && item.source.externalId === session.appId)),
    );
  if (installed || session.mode === 'options') {
    await api(`/api/apps/${encodeURIComponent(session.appId)}/operate`, {
      method: 'POST',
      body: { operation: 'configure', options: config },
    });
  } else {
    await api('/api/apps/install', {
      method: 'POST',
      body: { manifest: session.manifest, grantedPermissions: [], config },
    });
  }
  const title = session.manifest.name || session.appId;
  return {
    type: 'create_entry',
    flow_id: flowId,
    handler: session.appId,
    title,
    result: { entry_id: `app:${session.appId}`, title },
  };
}

export async function operateInstalledAppEntry(
  api: HubApiCaller,
  entryId: string,
  action: 'reload' | 'remove' | 'start' | 'stop',
): Promise<unknown> {
  const appId = normalizeAppFlowDomain(entryId);
  if (action === 'remove') {
    return api(`/api/apps/${encodeURIComponent(appId)}/operate`, {
      method: 'POST',
      body: { operation: 'remove' },
    });
  }
  const mapped = action === 'reload' ? 'restart' : action;
  return api(`/api/apps/${encodeURIComponent(appId)}/execute`, {
    method: 'POST',
    body: { action: mapped },
  });
}

export interface AppFlowDispatchContext {
  api: HubApiCaller;
  refreshDevices: () => Promise<void>;
  getAppFlow: (
    flowId: string,
  ) => { appSession?: AppFlowSession; appStep?: Record<string, unknown> } | undefined;
  setAppFlow: (flowId: string, session: AppFlowSession, step: Record<string, unknown>) => void;
  deleteFlow: (flowId: string) => void;
}

function extractFlowId(path: string): string | undefined {
  if (path.startsWith('config/config_entries/options/flow/')) {
    return path.slice('config/config_entries/options/flow/'.length);
  }
  if (path.startsWith('config/config_entries/flow/')) {
    return path.slice('config/config_entries/flow/'.length);
  }
  return undefined;
}

export async function handleAppFlowManagement(
  ctx: AppFlowDispatchContext,
  method: string,
  path: string,
  data: Record<string, unknown>,
): Promise<{ handled: true; result: unknown } | undefined> {
  const flowId = extractFlowId(path);
  if (flowId) {
    const flow = ctx.getAppFlow(flowId);
    if (!flow?.appSession) return undefined;
    if (method === 'GET' && flow.appStep) {
      return { handled: true, result: flow.appStep };
    }
    if (method === 'POST') {
      const result = await submitAppConfigFlow(ctx.api, flowId, flow.appSession, data);
      ctx.deleteFlow(flowId);
      await ctx.refreshDevices().catch(() => {});
      return { handled: true, result };
    }
    if (method === 'DELETE') {
      ctx.deleteFlow(flowId);
      return { handled: true, result: {} };
    }
    return undefined;
  }

  if (
    method === 'POST' &&
    (path === 'config/config_entries/flow' || path === 'config/config_entries/options/flow')
  ) {
    const mode = path === 'config/config_entries/options/flow' ? 'options' : 'config';
    const rawEntryId = typeof data.entry_id === 'string' ? data.entry_id : '';
    const handler = String(data.handler ?? '');
    const appTarget = mode === 'options' && isAppConfigEntryId(rawEntryId) ? rawEntryId : handler;
    if (!isAppFlowDomain(appTarget) && !(mode === 'options' && isAppConfigEntryId(appTarget))) {
      return undefined;
    }
    const nextFlowId = `flow_${Date.now()}`;
    const { session, step } = await startAppConfigFlow(ctx.api, appTarget, nextFlowId, mode);
    ctx.setAppFlow(nextFlowId, session, step);
    return { handled: true, result: step };
  }

  if (
    method === 'POST' &&
    path.startsWith('config/config_entries/entry/') &&
    path.endsWith('/reload')
  ) {
    const entryId = decodeURIComponent(
      path.slice('config/config_entries/entry/'.length, -'/reload'.length),
    );
    if (!isAppConfigEntryId(entryId)) return undefined;
    await operateInstalledAppEntry(ctx.api, entryId, 'reload');
    await ctx.refreshDevices().catch(() => {});
    return { handled: true, result: { require_restart: false } };
  }

  if (method === 'DELETE' && path.startsWith('config/config_entries/entry/')) {
    const entryId = decodeURIComponent(path.slice('config/config_entries/entry/'.length));
    if (!isAppConfigEntryId(entryId)) return undefined;
    await operateInstalledAppEntry(ctx.api, entryId, 'remove');
    await ctx.refreshDevices().catch(() => {});
    return { handled: true, result: { require_restart: false } };
  }

  return undefined;
}

export function appIntegrationTranslations(
  category: string,
  integration?: string,
): Record<string, unknown> {
  if (category === 'title') {
    return {
      component: Object.fromEntries(
        Object.entries(APP_FLOW_TITLES).map(([domain, title]) => [domain, { title }]),
      ),
    };
  }
  if (!integration || !APP_FLOW_DOMAINS.has(integration)) return {};
  const section = category === 'options' ? 'options' : 'config';
  if (integration === 'govee' || integration === 'homebridge-govee') {
    const isHybrid = integration === 'govee';
    return {
      component: {
        [integration]: {
          [section]: {
            step: {
              user: {
                title: isHybrid ? 'Connect Govee' : 'Connect Homebridge Govee',
                description: isHybrid
                  ? 'Smart outlets run locally via Homebridge Govee (LAN and Bluetooth) while lights use Govee2MQTT.'
                  : 'Sign in with your Govee account or continue with local LAN/Bluetooth control.',
                data: {
                  username: 'Govee email (optional for LAN)',
                  password: 'Govee password',
                  hybridSplit: 'Hybrid split (Homebridge outlets + Govee2MQTT lights)',
                  bleDisable: 'Disable Bluetooth Low Energy (BLE)',
                  awsDisable: 'Disable AWS IoT cloud',
                  lanDisable: 'Disable local LAN UDP',
                },
              },
            },
          },
        },
      },
    };
  }
  const title = APP_FLOW_TITLES[integration] ?? integration;
  return {
    component: {
      [integration]: {
        [section]: {
          step: {
            user: {
              title: `Configure ${title}`,
              description: `Install and manage ${title} on your Haus Hub.`,
              data: {},
            },
          },
        },
      },
    },
  };
}
