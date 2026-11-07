/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  AddonSupervisorConfig,
  DiscoveryPayload,
  MqttServiceDetails,
  SupervisorApiResponse,
} from './types.js';
import type { UnsupportedCapability } from '../engine.js';

export interface SupervisorServerOptions {
  mqtt?: MqttServiceDetails;
  systemVersion?: string;
  onOptionsChanged?: (slug: string, options: Record<string, unknown>) => void;
}

const UNSUPPORTED_SUPERVISOR_PREFIXES = [
  '/docker',
  '/host',
  '/os',
  '/supervisor',
  '/backups',
  '/security',
  '/mounts',
] as const;

export class SupervisorApiServer extends EventEmitter {
  private addonsByToken = new Map<string, AddonSupervisorConfig>();
  private addonsBySlug = new Map<string, AddonSupervisorConfig>();
  private discoveries = new Map<string, DiscoveryPayload>();
  private discoveryOwners = new Map<string, string>();
  private mqttConfig?: MqttServiceDetails;
  private systemVersion: string;
  private onOptionsChanged?: (slug: string, options: Record<string, unknown>) => void;
  private unsupported: Omit<UnsupportedCapability, 'reportedAt'>[] = [];

  constructor(options: SupervisorServerOptions = {}) {
    super();
    this.mqttConfig = options.mqtt;
    this.systemVersion = options.systemVersion ?? '2026.11.0';
    this.onOptionsChanged = options.onOptionsChanged;
  }

  registerAddon(config: AddonSupervisorConfig): void {
    this.addonsByToken.set(config.token, config);
    this.addonsBySlug.set(config.slug, config);
  }

  unregisterAddon(slug: string): void {
    const addon = this.addonsBySlug.get(slug);
    if (addon) {
      this.addonsByToken.delete(addon.token);
      this.addonsBySlug.delete(slug);
    }
  }

  getAddon(slug: string): AddonSupervisorConfig | undefined {
    return this.addonsBySlug.get(slug);
  }

  setMqttService(details: MqttServiceDetails): void {
    this.mqttConfig = details;
  }

  getUnsupportedCapabilities(pluginId?: string): Omit<UnsupportedCapability, 'reportedAt'>[] {
    if (!pluginId) return [...this.unsupported];
    return this.unsupported.filter((u) => u.pluginId === pluginId);
  }

  private sendJson(res: ServerResponse, statusCode: number, data: SupervisorApiResponse): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  private async readJsonBody<T>(req: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    if (!raw.trim()) return {} as T;
    return JSON.parse(raw) as T;
  }

  private isUnsupportedSupervisorRoute(pathname: string): boolean {
    return UNSUPPORTED_SUPERVISOR_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      this.sendJson(res, 401, {
        result: 'error',
        message: 'Unauthorized: missing supervisor token',
      });
      return true;
    }

    const token = authHeader.slice(7).trim();
    const addon = this.addonsByToken.get(token);
    if (!addon) {
      this.sendJson(res, 403, { result: 'error', message: 'Forbidden: invalid supervisor token' });
      return true;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    if (this.isUnsupportedSupervisorRoute(pathname)) {
      const record: Omit<UnsupportedCapability, 'reportedAt'> = {
        runtime: 'supervisor',
        pluginId: addon.slug,
        capability: `${method} ${pathname}`,
        reason: 'forbidden_host_or_daemon_api',
      };
      this.unsupported.push(record);
      this.emit('unsupportedCapability', record);
      this.sendJson(res, 403, {
        result: 'error',
        message: 'supervisor_capability_unsupported',
      });
      return true;
    }

    // Route: /addons/:slug/options or /addons/:slug/info
    if (pathname.startsWith('/addons/')) {
      const parts = pathname.split('/').filter(Boolean);
      const targetSlug = parts[1];
      const action = parts[2];

      if (targetSlug && targetSlug !== 'self' && targetSlug !== addon.slug) {
        this.sendJson(res, 403, {
          result: 'error',
          message: 'addon_scope_access_denied',
        });
        return true;
      }

      if (action === 'options') {
        if (method === 'GET') {
          this.sendJson(res, 200, {
            result: 'ok',
            data: { options: addon.options },
          });
          return true;
        }
        if (method === 'POST') {
          try {
            const body = await this.readJsonBody<{ options?: Record<string, unknown> }>(req);
            if (body.options && typeof body.options === 'object') {
              addon.options = { ...addon.options, ...body.options };
              this.onOptionsChanged?.(addon.slug, addon.options);
            }
            this.sendJson(res, 200, { result: 'ok' });
          } catch {
            this.sendJson(res, 400, { result: 'error', message: 'Invalid JSON payload' });
          }
          return true;
        }
      }

      if (action === 'info' && method === 'GET') {
        this.sendJson(res, 200, {
          result: 'ok',
          data: {
            name: addon.name,
            slug: addon.slug,
            version: addon.version,
            state: 'started',
            boot: 'auto',
            options: addon.options,
            ingress: !!addon.ingressPort,
            ingress_port: addon.ingressPort ?? null,
            ingress_url: addon.ingressPath ?? null,
          },
        });
        return true;
      }
    }

    // Route: /services/mqtt
    if (pathname === '/services/mqtt' && method === 'GET') {
      if (!this.mqttConfig) {
        this.sendJson(res, 404, { result: 'error', message: 'MQTT service not configured' });
        return true;
      }
      this.sendJson(res, 200, {
        result: 'ok',
        data: {
          host: this.mqttConfig.host,
          port: this.mqttConfig.port,
          ssl: this.mqttConfig.ssl,
          protocol: this.mqttConfig.protocol,
          username: this.mqttConfig.username ?? null,
          password: this.mqttConfig.password ?? null,
        },
      });
      return true;
    }

    // Route: /discovery
    if (pathname === '/discovery') {
      if (method === 'GET') {
        const list = Array.from(this.discoveries.values());
        this.sendJson(res, 200, { result: 'ok', data: { discovery: list } });
        return true;
      }
      if (method === 'POST') {
        try {
          const payload = await this.readJsonBody<DiscoveryPayload>(req);
          const uuid = payload.uuid ?? randomUUID();
          const record: DiscoveryPayload = { ...payload, addon: addon.slug, uuid };
          this.discoveries.set(uuid, record);
          this.discoveryOwners.set(uuid, addon.slug);
          this.sendJson(res, 200, { result: 'ok', data: { uuid } });
        } catch {
          this.sendJson(res, 400, { result: 'error', message: 'Invalid discovery payload' });
        }
        return true;
      }
    }

    // Route: /discovery/:uuid
    if (pathname.startsWith('/discovery/')) {
      const uuid = pathname.slice('/discovery/'.length);
      if (method === 'GET') {
        const record = this.discoveries.get(uuid);
        if (!record) {
          this.sendJson(res, 404, { result: 'error', message: 'Discovery record not found' });
          return true;
        }
        this.sendJson(res, 200, { result: 'ok', data: record });
        return true;
      }
      if (method === 'DELETE') {
        const owner = this.discoveryOwners.get(uuid);
        if (owner && owner !== addon.slug) {
          this.sendJson(res, 403, {
            result: 'error',
            message: 'discovery_ownership_violation',
          });
          return true;
        }
        this.discoveries.delete(uuid);
        this.discoveryOwners.delete(uuid);
        this.sendJson(res, 200, { result: 'ok' });
        return true;
      }
    }

    // Route: /info or /core/info
    if ((pathname === '/info' || pathname === '/core/info') && method === 'GET') {
      this.sendJson(res, 200, {
        result: 'ok',
        data: {
          version: this.systemVersion,
          arch: process.arch,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
      });
      return true;
    }

    this.sendJson(res, 404, { result: 'error', message: `Unknown route: ${pathname}` });
    return true;
  }
}
