/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { PluginInstaller } from './runtime/installer.js';
import { PluginProcess, type RuntimeOptions } from './runtime/host.js';
import { vendorCatalog } from './vendors/catalog/index.js';
import { vendorRoute, type DriverRoute } from './vendors/overrides.js';
import type { FFmpegInput } from './contracts.js';
import { authorizedWebhook } from './runtime/webhooks.js';

/** One controller API for opt-in vendor/plugin lifecycle. No first-run network side effects. */
export class Kitsune {
  readonly installer: PluginInstaller;
  readonly plugins = new Map<string, PluginProcess>();
  private enabling = new Map<string, ReturnType<Kitsune['startVendor']>>();
  private closed = false;
  constructor(
    private readonly options: RuntimeOptions,
    private readonly overrides: Readonly<Record<string, DriverRoute>> = {},
  ) {
    this.installer = new PluginInstaller(options.dataDirectory);
  }
  catalog() {
    return vendorCatalog.map((preset) => ({
      ...preset,
      route: vendorRoute(preset.id, this.overrides),
    }));
  }
  enable(vendor: string, version?: string) {
    if (this.closed) return Promise.reject(Error('kitsune_stopped'));
    const route = vendorRoute(vendor, this.overrides);
    const key = route.driver === 'native' ? `native:${vendor}` : route.package;
    if (!this.enabling.has(key))
      this.enabling.set(
        key,
        this.startVendor(vendor, version).finally(() => this.enabling.delete(key)),
      );
    return this.enabling.get(key)!;
  }
  private async startVendor(vendor: string, version?: string) {
    const route = vendorRoute(vendor, this.overrides);
    if (route.driver === 'native') return { driver: 'native' as const, vendor };
    const existing = this.plugins.get(route.package);
    if (existing) return existing;
    const maximum = this.options.maxPlugins ?? 2;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 32)
      throw Error('kitsune_invalid_plugin_budget');
    if (
      this.plugins.size +
        [...this.enabling.keys()].filter((key) => !key.startsWith('native:')).length >=
      maximum
    )
      throw Error('kitsune_plugin_capacity');
    const plugin = await this.installer.install(route.package, version ?? route.version);
    if (this.closed) throw Error('kitsune_stopped');
    const runtime = new PluginProcess(plugin, this.options);
    try {
      await runtime.start();
      if (this.closed) throw Error('kitsune_stopped');
      this.plugins.set(route.package, runtime);
      runtime.once('stopped', () => {
        if (this.plugins.get(route.package) === runtime) this.plugins.delete(route.package);
      });
      return runtime;
    } catch (error) {
      await runtime.stop();
      throw error;
    }
  }
  async bootstrapBasePlugins() {
    return Promise.all(
      vendorCatalog.filter((preset) => preset.base).map((preset) => this.enable(preset.id)),
    );
  }
  /** The Haus HTTP router supplies auth/body limits; only enrolled plugin paths are routed. */
  canWebhook(pluginId: string, token: string) {
    return (
      this.plugins.has(pluginId) && authorizedWebhook(this.options.dataDirectory, pluginId, token)
    );
  }
  async webhook(
    pluginId: string,
    nativeId: string | undefined,
    request: {
      method: string;
      url: string;
      rootPath?: string;
      headers: Record<string, string>;
      body?: string;
    },
    token: string,
  ) {
    if (!this.canWebhook(pluginId, token)) throw Error('kitsune_webhook_authentication_required');
    const runtime = this.plugins.get(pluginId);
    if (!runtime) throw Error('kitsune_plugin_offline');
    // Buffer response methods live in the child; arbitrary functions are never sent over IPC.
    return runtime.call('webhook', [nativeId, request]);
  }
  async stream(pluginId: string, deviceId: string, options?: Record<string, string>) {
    const runtime = this.plugins.get(pluginId);
    if (!runtime) throw Error('kitsune_plugin_offline');
    const media = await runtime.call<{ mimeType: string; data: Buffer }>(
      'video',
      [options],
      deviceId,
    );
    if (media.mimeType !== 'x-scrypted/x-ffmpeg-input')
      throw Error('kitsune_media_adapter_required');
    const input = JSON.parse(media.data.toString()) as FFmpegInput;
    if (
      !Array.isArray(input.inputArguments) ||
      input.inputArguments.some((arg) => typeof arg !== 'string')
    )
      throw Error('kitsune_invalid_media');
    return input; // Host media adapter validates/pins source URLs before assigning an NVR.
  }
  async stop() {
    this.closed = true;
    await Promise.allSettled(this.enabling.values());
    const plugins = [...this.plugins.values()];
    this.plugins.clear();
    await Promise.all(plugins.map((plugin) => plugin.stop()));
  }
}
