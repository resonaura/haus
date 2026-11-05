/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import { Commands } from '@haus/core/command';
import type { Command } from '@haus/core/types';
import { OwnedCredentials, sessionKey, TokenRefresh } from '@haus/core/session';
import type { IntegrationRef, SessionGrant } from '@haus/core/session';
import type { Host } from './host.js';
import { ProviderGate } from './gate.js';
import type {
  ControlAction,
  ControlPermissions,
  IntegrationDefinition,
  LocalRecovery,
} from './types.js';

export class Integration<Credential> {
  readonly resource: IntegrationRef;
  private readonly vault;
  private readonly credentials;
  private grant?: SessionGrant;
  private gate?: ProviderGate<Credential>;
  private refresher?: TokenRefresh<Credential>;
  private refreshing?: Promise<void>;
  private commands?: Commands;
  private queue = Promise.resolve();
  private closed = false;
  private readonly cancellation = new AbortController();
  private closing?: Promise<void>;

  constructor(
    private readonly host: Host,
    private readonly definition: IntegrationDefinition<Credential>,
    private readonly permissions: ControlPermissions,
    private readonly recovery: LocalRecovery,
    private readonly timeoutMs = 15_000,
  ) {
    sessionKey(definition.resource);
    if (definition.resource.homeId !== host.identity.homeId)
      throw Error('integration_home_mismatch');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('invalid_integration_timeout');
    this.resource = Object.freeze({ ...definition.resource });
    this.vault = host.vault(definition.codec);
    this.credentials = new OwnedCredentials(host.owner, host.ownership, this.vault);
  }

  signIn(actorId: string, credential: Credential): Promise<void> {
    return this.serial(async () => {
      this.assertOpen();
      await this.authorize(actorId, this.grant ? 'reauthorize' : 'connect');
      this.assertOpen();
      if (this.grant) {
        this.gate?.stopAdmission();
        await this.host.ownership.requireReauthorization(this.grant);
        await this.fenceLocal();
        await this.vault.install(this.grant, credential);
        await this.host.ownership.reconnect(this.grant);
      } else {
        this.grant = await this.host.ownership.acquire(this.resource, this.host.owner);
        this.assertOpen();
        await this.vault.install(this.grant, credential);
      }
      await this.openProvider();
    });
  }

  resume(actorId: string): Promise<'connected' | 'reauth-required'> {
    return this.serial(async () => {
      this.assertOpen();
      await this.authorize(actorId, 'recover');
      this.assertOpen();
      if (this.grant) throw Error('integration_already_started');
      const previous = await this.host.sessions.read(this.resource);
      if (previous) {
        if (
          previous.owner.hubId !== this.host.owner.hubId ||
          previous.owner.processId === this.host.owner.processId
        )
          throw Error('integration_local_recovery_unavailable');
        if (previous.state !== 'revoked')
          await this.host.ownership.revoke(previous, async () => {
            try {
              await this.recovery.fence(structuredClone(previous), this.host.owner);
            } catch {
              throw Error('integration_recovery_unverified');
            }
          });
      }
      this.assertOpen();
      this.grant = await this.host.ownership.acquire(this.resource, this.host.owner);
      this.assertOpen();
      const usable =
        previous &&
        ['connected', 'revoked'].includes(previous.state) &&
        (await this.vault.rebind(previous, this.grant));
      if (!usable) {
        await this.host.ownership.requireReauthorization(this.grant);
        return 'reauth-required';
      }
      await this.openProvider();
      return 'connected';
    });
  }

  async execute(actorId: string, idempotencyKey: string, command: Command) {
    this.assertOpen();
    if (!this.grant || !this.commands) throw Error('integration_not_connected');
    const grant = this.grant,
      commands = this.commands,
      intent = structuredClone(command);
    await this.refreshing;
    this.assertOpen();
    if (this.grant !== grant || this.commands !== commands)
      throw Error('integration_session_changed');
    return commands.execute({ actorId, idempotencyKey, command: intent, grant });
  }

  refresh(): Promise<void> {
    this.assertOpen();
    if (!this.grant || !this.refresher) return Promise.reject(Error('integration_not_connected'));
    if (this.refreshing) return this.refreshing;
    const pending = this.refresher.refresh(this.grant).finally(() => {
      if (this.refreshing === pending) this.refreshing = undefined;
    });
    this.refreshing = pending;
    return pending;
  }

  disconnect(actorId: string): Promise<void> {
    return this.serial(async () => {
      this.assertOpen();
      await this.authorize(actorId, 'disconnect');
      await this.revoke(true);
    });
  }

  close(): Promise<void> {
    this.closed = true;
    this.cancellation.abort();
    this.gate?.stopAdmission();
    if (!this.closing)
      this.closing = this.serial(() => this.revoke(false)).catch(() => {
        this.closing = undefined;
        throw Error('integration_fence_incomplete');
      });
    return this.closing;
  }

  private async openProvider(): Promise<void> {
    const grant = this.grant;
    if (!grant) throw Error('integration_not_owned');
    this.assertOpen();
    try {
      let ownedGate: ProviderGate<Credential> | undefined;
      const current = () => {
        this.assertOpen();
        if (!ownedGate || this.gate !== ownedGate || !ownedGate.accepting)
          throw Error('provider_admission_closed');
      };
      const provider = this.definition.create({
        grant: structuredClone(grant),
        identities: this.host.identities,
        credential: async () => {
          current();
          return this.credentials.use(grant, async (credential) => {
            current();
            return credential;
          });
        },
        refresh: async () => {
          current();
          await this.refresh();
        },
      });
      const gate = new ProviderGate(grant, this.credentials, provider, this.timeoutMs);
      ownedGate = gate;
      this.gate = gate;
      this.refresher = new TokenRefresh(
        this.host.ownership,
        this.vault,
        gate,
        randomUUID,
        this.timeoutMs,
      );
      this.commands = new Commands(
        this.host.ownership,
        {
          authorize: async (actorId, command) => {
            try {
              await this.authorize(actorId, 'control', command);
              return true;
            } catch {
              return false;
            }
          },
          fingerprint: (intent) => this.host.fingerprint(intent),
        },
        this.host.receipts,
        gate,
        this.timeoutMs,
      );
      await gate.open();
      this.assertOpen();
      await this.host.ownership.connected(grant);
      this.assertOpen();
    } catch {
      this.gate?.stopAdmission();
      await this.host.ownership.requireReauthorization(grant);
      await this.fenceLocal();
      throw Error('integration_connection_failed');
    }
  }

  private async fenceLocal(): Promise<void> {
    this.gate?.stopAdmission();
    const results = await Promise.allSettled([
      this.gate?.close() ?? Promise.resolve(),
      this.grant && this.refresher ? this.refresher.fence(this.grant) : Promise.resolve(),
    ]);
    if (results.some((result) => result.status === 'rejected'))
      throw Error('integration_fence_incomplete');
  }

  private async revoke(forget: boolean): Promise<void> {
    if (!this.grant) return;
    const grant = this.grant;
    this.gate?.stopAdmission();
    await this.host.ownership.revoke(grant, async () => {
      await this.fenceLocal();
      if (forget) await this.vault.erase(grant);
    });
    this.grant = undefined;
    this.gate = undefined;
    this.refresher = undefined;
    this.commands = undefined;
  }

  private async authorize(
    actorId: string,
    action: ControlAction,
    command?: Command,
  ): Promise<void> {
    if (typeof actorId !== 'string' || !actorId.trim() || actorId.length > 4096)
      throw Error('control_permission_denied');
    const deadline = new AbortController(),
      signal = AbortSignal.any([deadline.signal, this.cancellation.signal]);
    let abort = () => {};
    const timer = setTimeout(() => deadline.abort(), this.timeoutMs);
    try {
      if (signal.aborted) throw Error('control_permission_denied');
      const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => reject(Error('control_permission_denied'));
        signal.addEventListener('abort', abort, { once: true });
      });
      if (
        await Promise.race([
          this.permissions.authorize(actorId, this.resource, action, command, signal),
          interrupted,
        ])
      )
        return;
    } catch {
      /* An unavailable permission service cannot grant access. */
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
    throw Error('control_permission_denied');
  }

  private assertOpen(): void {
    if (this.closed) throw Error('integration_closed');
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}
