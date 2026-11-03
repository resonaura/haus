/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  entityKeys,
  inventoryRevision,
  uuid,
  validateInventory,
  type BridgeInventory,
  type Provider,
} from './protocol.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
interface Client {
  id: string;
  tokenHash: string;
  controllerId: string;
}
interface Lease {
  clientId: string;
  revision: string;
  until: number;
}
interface Options {
  directory: string;
  provider: Provider;
  name: string;
  disableMqttWithHaus?: boolean;
  now?: () => number;
}

/** Pairing alone never suppresses MQTT. Every current native entity must first be acknowledged. */
export class CameraBridgeProvider extends EventEmitter {
  readonly provider: Provider;
  readonly name: string;
  readonly directory: string;
  readonly now: () => number;
  id!: string;
  private clients: Client[] = [];
  private nativeOwner?: { clientId: string; revision: string };
  private lease?: Lease;
  private inventory?: BridgeInventory;
  private code?: { hash: string; until: number };
  private suppress: boolean;
  private lastPublish = true;
  private serial: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(options: Options) {
    super();
    this.directory = options.directory;
    this.provider = options.provider;
    this.name = options.name;
    this.now = options.now ?? Date.now;
    this.suppress = options.disableMqttWithHaus ?? true;
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const value = JSON.parse(await readFile(join(this.directory, 'haus-provider.json'), 'utf8'));
      if (
        !uuid(value.id) ||
        value.provider !== this.provider ||
        !Array.isArray(value.clients) ||
        value.clients.length > 16 ||
        value.clients.some(
          (item: Client) =>
            !uuid(item.id) || !uuid(item.controllerId) || !/^[a-f0-9]{64}$/.test(item.tokenHash),
        )
      )
        throw Error('invalid_bridge_identity');
      this.id = value.id;
      this.clients = value.clients;
      if (value.nativeOwner !== undefined) {
        if (
          !this.clients.some((client) => client.id === value.nativeOwner.clientId) ||
          !/^[a-f0-9]{64}$/.test(value.nativeOwner.revision)
        )
          throw Error('invalid_bridge_identity');
        this.nativeOwner = value.nativeOwner;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.id = randomUUID();
      await this.save();
    }
    return this;
  }
  private async save() {
    const file = join(this.directory, 'haus-provider.json');
    await writeFile(
      file + '.next',
      JSON.stringify({
        id: this.id,
        provider: this.provider,
        clients: this.clients,
        nativeOwner: this.nativeOwner,
      }),
      { mode: 0o600 },
    );
    await rename(file + '.next', file);
  }
  private transaction<T>(action: () => Promise<T>): Promise<T> {
    const task = this.serial.then(action);
    this.serial = task.catch(() => {});
    return task;
  }
  info() {
    return {
      version: 2 as const,
      bridgeId: this.id,
      provider: this.provider,
      name: this.name,
      pairing: 'code' as const,
    };
  }
  openPairing() {
    if (this.closed) throw Error('bridge_closed');
    const code = randomBytes(24).toString('hex');
    this.code = { hash: digest(code), until: this.now() + 600000 };
    return { code, expiresAt: this.code.until };
  }
  enroll(code: string, controllerId: string) {
    return this.transaction(async () => {
      if (
        this.closed ||
        !uuid(controllerId) ||
        typeof code !== 'string' ||
        !/^[a-f0-9]{48}$/.test(code) ||
        !this.code ||
        this.code.until <= this.now() ||
        digest(code) !== this.code.hash
      )
        throw Error('invalid_bridge_pairing');
      this.code = undefined;
      if (this.clients.length >= 16) throw Error('bridge_clients_full');
      const token = randomBytes(32).toString('hex');
      const client = { id: randomUUID(), tokenHash: digest(token), controllerId };
      this.clients.push(client);
      try {
        await this.save();
      } catch (error) {
        this.clients.pop();
        throw error;
      }
      return { clientId: client.id, token, bridgeId: this.id, version: 2 as const };
    });
  }
  authenticate(authorization: string | undefined) {
    if (this.closed) return;
    const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? '')?.[1];
    return token
      ? this.clients.find((client) => client.tokenHash === digest(token))?.id
      : undefined;
  }
  async revoke(clientId: string) {
    return this.transaction(async () => {
      const previous = this.clients;
      const previousOwner = this.nativeOwner;
      this.clients = this.clients.filter((client) => client.id !== clientId);
      if (this.nativeOwner?.clientId === clientId) this.nativeOwner = undefined;
      try {
        await this.save();
      } catch (error) {
        this.clients = previous;
        this.nativeOwner = previousOwner;
        throw error;
      }
      if (this.lease?.clientId === clientId) this.lease = undefined;
      this.tick();
    });
  }
  updateInventory(input: unknown) {
    const inventory = validateInventory(input);
    if (inventory.bridgeId !== this.id || inventory.provider !== this.provider)
      throw Error('bridge_identity_mismatch');
    this.inventory = inventory;
    this.tick();
    return inventoryRevision(inventory);
  }
  readInventory(clientId: string) {
    this.authorize(clientId);
    if (!this.inventory) throw Error('bridge_inventory_unavailable');
    return { ...structuredClone(this.inventory), revision: inventoryRevision(this.inventory) };
  }
  private authorize(clientId: string) {
    if (this.closed || !this.clients.some((client) => client.id === clientId))
      throw Error('bridge_access_required');
  }
  confirmNativeReady(clientId: string, input: { revision: string; entities: string[] }) {
    return this.transaction(async () => {
      this.authorize(clientId);
      if (
        !this.inventory ||
        !this.inventory.cameras.length ||
        !input ||
        input.revision !== inventoryRevision(this.inventory) ||
        !Array.isArray(input.entities) ||
        input.entities.length > 16512 ||
        new Set(input.entities).size !== input.entities.length ||
        JSON.stringify([...input.entities].sort()) !== JSON.stringify(entityKeys(this.inventory))
      )
        throw Error('incomplete_bridge_handover');
      if (this.nativeOwner && this.nativeOwner.clientId !== clientId)
        throw Error('bridge_already_owned');
      const previous = this.nativeOwner;
      this.nativeOwner = { clientId, revision: input.revision };
      try {
        await this.save();
      } catch (error) {
        this.nativeOwner = previous;
        throw error;
      }
      this.lease = { clientId, revision: input.revision, until: this.now() + 65000 };
      this.tick();
      return { expiresAt: this.lease.until, publishMqtt: this.shouldPublishMqtt() };
    });
  }
  renew(clientId: string, revision: string) {
    this.authorize(clientId);
    if (
      !this.inventory ||
      !this.lease ||
      this.lease.clientId !== clientId ||
      this.lease.until <= this.now() ||
      this.lease.revision !== revision ||
      inventoryRevision(this.inventory) !== revision
    )
      throw Error('bridge_handover_required');
    this.lease.until = this.now() + 65000;
    this.tick();
    return { expiresAt: this.lease.until };
  }
  setDisableMqttWithHaus(value: boolean) {
    if (typeof value !== 'boolean') throw Error('invalid_mqtt_policy');
    this.suppress = value;
    this.tick();
  }
  shouldPublishMqtt() {
    return !this.suppress || !this.nativeOwner;
  }
  nativeStatus() {
    return {
      confirmed: !!this.nativeOwner,
      reachable: !!this.lease && this.lease.until > this.now(),
      publishMqtt: this.shouldPublishMqtt(),
    };
  }
  tick() {
    const enabled = this.shouldPublishMqtt();
    if (enabled !== this.lastPublish) {
      this.lastPublish = enabled;
      this.emit('mqtt-publication', enabled);
    }
  }
  async stop() {
    this.closed = true;
    this.code = undefined;
    this.lease = undefined;
    this.tick();
    await this.serial;
  }
}
