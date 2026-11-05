/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Command } from '@haus/core/types';
import type { IntegrationRef, SessionRecord } from '@haus/core/session';
import type { Host } from './host.js';
import { Integration } from './integration.js';
import { OsProcessRecovery } from './recovery.js';
import type {
  ControlAction,
  ControlPermissions,
  IntegrationDefinition,
  LocalRecovery,
  ProviderReply,
} from './types.js';

export class TrustedControlPermissions implements ControlPermissions {
  async authorize(
    actorId: string,
    _resource: IntegrationRef,
    _action: ControlAction,
    _command?: Command,
    signal?: AbortSignal,
  ): Promise<boolean> {
    signal?.throwIfAborted();
    return typeof actorId === 'string' && actorId.trim().length > 0;
  }
}

export interface ControlServiceOptions {
  readonly host: Host;
  readonly permissions?: ControlPermissions;
  readonly recovery?: LocalRecovery;
  readonly timeoutMs?: number;
}

/** Hub control service managing integration instances and ordered lifecycle. */
export class ControlService {
  readonly host: Host;
  private readonly permissions: ControlPermissions;
  private readonly recovery: LocalRecovery;
  private readonly timeoutMs: number;
  private readonly integrations = new Map<string, Integration<unknown>>();
  private closing?: Promise<void>;

  constructor(options: ControlServiceOptions) {
    this.host = options.host;
    this.permissions = options.permissions ?? new TrustedControlPermissions();
    this.recovery = options.recovery ?? new OsProcessRecovery(options.host.files);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  register<Credential>(definition: IntegrationDefinition<Credential>): Integration<Credential> {
    if (this.closing) throw Error('control_service_closed');
    const existing = this.integrations.get(definition.resource.id);
    if (existing) return existing as Integration<Credential>;
    const integration = new Integration<Credential>(
      this.host,
      definition,
      this.permissions,
      this.recovery,
      this.timeoutMs,
    );
    this.integrations.set(definition.resource.id, integration as Integration<unknown>);
    return integration;
  }

  get<Credential = unknown>(resourceId: string): Integration<Credential> | undefined {
    return this.integrations.get(resourceId) as Integration<Credential> | undefined;
  }

  async connect(actorId: string, resourceId: string, credential: unknown): Promise<void> {
    const integration = this.requireIntegration(resourceId);
    return integration.signIn(actorId, credential);
  }

  async resume(actorId: string, resourceId: string): Promise<'connected' | 'reauth-required'> {
    const integration = this.requireIntegration(resourceId);
    return integration.resume(actorId);
  }

  async disconnect(actorId: string, resourceId: string): Promise<void> {
    const integration = this.requireIntegration(resourceId);
    return integration.disconnect(actorId);
  }

  async refresh(resourceId: string): Promise<void> {
    const integration = this.requireIntegration(resourceId);
    return integration.refresh();
  }

  async execute(
    actorId: string,
    resourceId: string,
    idempotencyKey: string,
    command: Command,
  ): Promise<ProviderReply> {
    const integration = this.requireIntegration(resourceId);
    return integration.execute(actorId, idempotencyKey, command);
  }

  async session(resourceId: string): Promise<SessionRecord | undefined> {
    const integration = this.requireIntegration(resourceId);
    return this.host.sessions.read(integration.resource);
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      // Integrations must be closed and fenced before Host.close() drains storage.
      const list = Array.from(this.integrations.values());
      for (const item of list) {
        try {
          await item.close();
        } catch {
          // Keep draining other integrations and host
        }
      }
      this.integrations.clear();
      await this.host.close();
    })();
    return this.closing;
  }

  private requireIntegration(resourceId: string): Integration<unknown> {
    if (this.closing) throw Error('control_service_closed');
    const integration = this.integrations.get(resourceId);
    if (!integration) throw Error('integration_not_found');
    return integration;
  }
}
