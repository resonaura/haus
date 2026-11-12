/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { SupervisorApiServer, type MqttServiceDetails } from '@haus/kitsune';
import type { AppManifest } from '@haus/apps';
import { PrivateFiles } from '../control/files.js';
import { loadKey } from '../control/key.js';

export interface AppSupervisorOptions {
  readonly dataDirectory: string;
  /** Path to dataDirectory as seen by the Docker daemon host, when different. */
  readonly hostDataDirectory?: string;
  readonly port: number;
  readonly listeningPort?: () => number | undefined;
  readonly env?: NodeJS.ProcessEnv;
}

const API_PREFIX = '/api/supervisor';
const MQTT_SERVICES = new Set(['mqtt', 'mqtt:need', 'mqtt:want', 'mqtt:required']);

/** Restricted Supervisor compatibility for Apps managed by the standalone Hub. */
export class AppSupervisor {
  private api?: SupervisorApiServer;
  private key?: Buffer;
  private options?: AppSupervisorOptions;

  async configure(options: AppSupervisorOptions): Promise<void> {
    if (this.api) throw Error('app_supervisor_already_configured');
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)
      throw Error('invalid_app_supervisor_port');

    const files = new PrivateFiles(join(options.dataDirectory, 'local'));
    await files.prepare();
    const key = await loadKey(files);
    this.options = options;
    this.key = key;
    this.api = new SupervisorApiServer();
  }

  async register(
    manifest: AppManifest,
    appOptions: Record<string, unknown> = {},
  ): Promise<Readonly<Record<string, string>>> {
    if (!this.api || !this.key || !this.options) throw Error('app_supervisor_not_configured');
    if (!manifest.services?.some((service) => MQTT_SERVICES.has(service))) return {};

    const mode = manifest.network?.mode ?? 'bridge';
    if (mode === 'internal' || mode === 'none') throw Error('app_mqtt_unreachable_from_network');

    const serviceHost = mode === 'host' ? '127.0.0.1' : 'host.docker.internal';
    const port =
      this.options.listeningPort?.() ?? (this.options.port > 0 ? this.options.port : undefined);
    const runtimeEnv: Record<string, string> = port
      ? {
          SUPERVISOR_API: `http://${serviceHost}:${port}${API_PREFIX}`,
          SUPERVISOR_TOKEN: createHmac('sha256', this.key)
            .update(`haus-app-supervisor\0${manifest.id}`)
            .digest('hex'),
        }
      : {};
    const environment = this.options.env ?? process.env;
    const mqtt: MqttServiceDetails = {
      host: serviceHost,
      port: Number(environment.HAUS_MQTT_PORT ?? 1883),
      ssl: false,
      protocol: '3.1.1',
      username: environment.HAUS_MQTT_USER ?? '',
      password: environment.HAUS_MQTT_PASS ?? '',
    };
    if (!Number.isInteger(mqtt.port) || mqtt.port < 1 || mqtt.port > 65535)
      throw Error('invalid_app_mqtt_port');

    this.api.registerAddon({
      slug: manifest.id,
      name: manifest.name,
      version: manifest.version,
      token: runtimeEnv.SUPERVISOR_TOKEN,
      options: { ...appOptions },
      mqtt,
    });
    return runtimeEnv;
  }

  unregister(appId: string): void {
    this.api?.unregisterAddon(appId);
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== API_PREFIX && !url.pathname.startsWith(`${API_PREFIX}/`)) return false;

    if (url.pathname !== `${API_PREFIX}/services/mqtt`) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result: 'error', message: 'not_found' }));
      return true;
    }
    if (req.method?.toUpperCase() !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      res.end();
      return true;
    }

    const api = this.api;
    if (!api) {
      res.statusCode = 503;
      res.end();
      return true;
    }
    const originalUrl = req.url;
    req.url = `${url.pathname.slice(API_PREFIX.length)}${url.search}`;
    try {
      const handled = await api.handleRequest(req, res);
      if (!handled && !res.writableEnded) {
        res.statusCode = 404;
        res.end();
      }
    } finally {
      req.url = originalUrl;
    }
    return true;
  }

  async close(): Promise<void> {
    this.key?.fill(0);
    this.key = undefined;
    this.api = undefined;
    this.options = undefined;
  }
}
