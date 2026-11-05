/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntityActionQueue } from '@haus/core/command-queue';
import type { Identities } from '@haus/core/types';
import type {
  App,
  AppAction,
  AppDriver,
  AppInfo,
  AppInventory,
  AppOperation,
  AppOperationResult,
  AppPolicy,
  RuntimeApp,
} from './types.js';
export type * from './types.js';
export * from './manifest.js';
export * from './policy.js';
export * from './lifecycle.js';
export * from './dag.js';
export * from './host/index.js';

/** Controls enrolled runtimes through explicit permissions; never a general daemon proxy. */
export class Apps {
  private readonly drivers = new Map<string, AppDriver>();
  private readonly cached = new Map<string, App>();
  private readonly queue = new EntityActionQueue();
  constructor(
    private readonly identities: Identities,
    private readonly policy: AppPolicy,
  ) {}
  register(driver: AppDriver) {
    if (!driver.id || this.drivers.has(driver.id)) throw Error('duplicate_app_runtime');
    this.drivers.set(driver.id, driver);
  }
  private record(driver: AppDriver, app: RuntimeApp): App {
    const source = { instanceId: driver.id, externalId: app.externalId };
    const { externalId: _id, ...visible } = app;
    return {
      ...visible,
      id: this.identities.resolve({ ...source, externalId: 'app:' + source.externalId }),
      source,
      available: true,
    };
  }
  async list(actorId: string, signal?: AbortSignal): Promise<AppInventory> {
    const results = await Promise.all(
      [...this.drivers.values()].map(async (driver) => {
        if (!(await this.policy.authorize(actorId, 'read', { driverId: driver.id })))
          return undefined;
        try {
          const values = await driver.list(signal);
          signal?.throwIfAborted();
          const current = values.slice(0, 2000).map((app) => this.record(driver, app));
          for (const [id, app] of this.cached)
            if (app.source.instanceId === driver.id) this.cached.delete(id);
          for (const app of current) this.cached.set(app.id, app);
          return {
            driver: { id: driver.id, available: true, capabilities: driver.capabilities },
            apps: current,
          };
        } catch {
          signal?.throwIfAborted();
          return {
            driver: { id: driver.id, available: false, capabilities: driver.capabilities },
            apps: [...this.cached.values()]
              .filter((app) => app.source.instanceId === driver.id)
              .map((app) => ({ ...app, available: false, state: 'unknown' as const, actions: [] })),
          };
        }
      }),
    );
    return {
      apps: results.flatMap((result) => result?.apps ?? []),
      drivers: results.flatMap((result) => (result ? [result.driver] : [])),
    };
  }
  async execute(actorId: string, appId: string, action: AppAction, signal?: AbortSignal) {
    return this.queue.run(appId, async () => {
      signal?.throwIfAborted();
      const app = this.cached.get(appId),
        driver = app && this.drivers.get(app.source.instanceId);
      if (!app || !driver) throw Error('unknown_app');
      if (
        !(await this.policy.authorize(actorId, action, {
          driverId: driver.id,
          externalId: app.source.externalId,
        }))
      )
        throw Error('app_permission_denied');
      // Re-read ownership and capabilities after waiting in the queue. No write retry.
      const current = (await driver.list(signal)).find(
        (item) => item.externalId === app.source.externalId,
      );
      if (!current?.managed || !current.actions.includes(action))
        throw Error('app_action_unavailable');
      await driver.execute(app.source.externalId, action, signal);
    });
  }
  async inspect(
    actorId: string,
    appId: string,
    signal?: AbortSignal,
  ): Promise<AppOperationResult<AppInfo>> {
    const app = this.cached.get(appId),
      driver = app && this.drivers.get(app.source.instanceId);
    if (!app || !driver) return { status: 'error', reason: 'unknown_app' };
    if (!(await this.policy.authorize(actorId, 'read', { driverId: driver.id })))
      return { status: 'error', reason: 'app_permission_denied' };
    return driver.inspect(app.source.externalId, signal);
  }
  async operate(
    actorId: string,
    appId: string,
    operation: AppOperation,
    options?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AppOperationResult> {
    const app = this.cached.get(appId),
      driver = app && this.drivers.get(app.source.instanceId);
    if (!app || !driver) return { status: 'error', reason: 'unknown_app' };
    if (!driver.capabilities[operation])
      return { status: 'unsupported', reason: `${driver.id}_does_not_support_${operation}` };
    if (!(await this.policy.authorize(actorId, 'read', { driverId: driver.id })))
      return { status: 'error', reason: 'app_permission_denied' };
    return driver.operate(operation, app.source.externalId, options, signal);
  }
}
