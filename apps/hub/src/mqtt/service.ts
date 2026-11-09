/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  HausMqttBroker,
  DiscoveryTopics,
  buildCommandMessages,
  consolidateLegacyMqttDevices,
  extractJsonAttributes,
  extractEndpointStatePatch,
  type MqttCommand,
  type MqttMessage,
  type RetainedStore,
} from '@haus/mqtt';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../home/home.service.js';
import { HAUS_MQTT_OPTIONS } from './tokens.js';
import { DiscoveryBindings } from './bindings.js';
import { OrmMqttRetention } from '../storage/mqtt/retention.js';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import { CatalogLifetime } from '../storage/lifetime.js';
import type { MqttServiceOptions } from './options.js';
import { MqttDiscovery } from './discovery.js';
import { MqttIdentities, MemoryMqttIdentities } from './identity.js';
import { OrmIdentities } from '../storage/identity.js';

@Injectable()
export class MqttService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MqttService.name);
  public readonly broker: HausMqttBroker;
  private readonly bindings = new DiscoveryBindings();
  private unregisterCommandHandler?: () => void;
  private isStarted = false;
  private readonly retainedStore?: RetainedStore;
  private stopSubscribers: (() => void)[] = [];
  private readonly discoveryTopics: DiscoveryTopics;
  private readonly discovery: MqttDiscovery;
  private readonly identities: MqttIdentities;
  private messages: Promise<void> = Promise.resolve();
  private readonly stateWrites = new Set<Promise<void>>();
  private readonly warnedAttributes = new Set<string>();

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional()
    @Inject(HAUS_MQTT_OPTIONS)
    options?: MqttServiceOptions,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
    @Optional() @Inject(CatalogLifetime) lifetime?: CatalogLifetime,
  ) {
    const port = options?.port ?? Number(process.env.HAUS_MQTT_PORT || 1883);
    const host = options?.host ?? process.env.HAUS_MQTT_HOST ?? '0.0.0.0';
    const allowAnonymous = options?.allowAnonymous ?? process.env.HAUS_MQTT_ALLOW_ANON !== 'false';
    this.discoveryTopics = new DiscoveryTopics(
      options?.discoveryPrefixes ??
        process.env.HAUS_MQTT_DISCOVERY_PREFIXES?.split(',').map((prefix) => prefix.trim()),
    );
    this.identities = new MqttIdentities(
      transactions ? new OrmIdentities(transactions) : new MemoryMqttIdentities(),
      options?.homeId ?? process.env.HAUS_HOME_ID ?? 'home-default',
      () => homeService?.listDevices() ?? [],
    );
    this.discovery = new MqttDiscovery(
      homeService,
      this.bindings,
      this.discoveryTopics,
      this.logger,
      this.identities,
    );
    this.retainedStore =
      options?.retainedStore ??
      (transactions ? new OrmMqttRetention(transactions, this.discoveryTopics) : undefined);

    this.broker = new HausMqttBroker({
      port,
      host,
      allowAnonymous,
      username: options?.username ?? process.env.HAUS_MQTT_USER,
      password: options?.password ?? process.env.HAUS_MQTT_PASS,
      retainedStore: this.retainedStore,
    });
    lifetime?.defer(() => this.onApplicationShutdown());
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.isStarted) return;
    try {
      if (this.homeService) {
        const home = this.homeService;
        const managed = await this.identities.managedDevices();
        const consolidated = consolidateLegacyMqttDevices({
          listDevices: () => home.listDevices().filter((device) => !managed.has(device.id)),
          registerDevice: (device) => home.registerDevice(device),
          removeDevice: (id) => home.removeDevice(id),
          getEndpointState: (id) => home.getEndpointState(id),
          updateEndpointState: (id, patch, dispatch) =>
            home.updateEndpointState(id, patch, dispatch),
        });
        if (consolidated > 0) {
          this.logger.log(`Consolidated ${consolidated} fragmented legacy MQTT device entries.`);
        }
      }

      await this.restoreRetained();
      this.setupMqttSubscribers();
      const bound = await this.broker.listen();
      this.isStarted = true;
      this.logger.log(`Native Haus MQTT Broker listening on ${bound.host}:${bound.port}`);

      if (this.homeService) {
        this.unregisterCommandHandler = this.homeService.registerCommandHandler(
          'mqtt',
          async (endpointId, capability, command, parameters) => {
            await this.handleDeviceCommand(endpointId, capability, command, parameters);
          },
        );
      }
    } catch {
      this.logger.error('mqtt_start_failed');
      this.stopSubscribers.splice(0).forEach((stop) => stop());
      await this.broker.close();
      throw Error('mqtt_start_failed');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.unregisterCommandHandler?.();
    if (this.isStarted) {
      await this.broker.close();
      this.stopSubscribers.splice(0).forEach((stop) => stop());
      await this.drain();
      this.isStarted = false;
      this.logger.log('Native Haus MQTT Broker stopped.');
    }
  }

  async publish(command: MqttCommand): Promise<void> {
    return this.broker.publish(command);
  }

  async drain(): Promise<void> {
    await this.messages;
    await Promise.all(this.stateWrites);
  }

  private async restoreRetained(): Promise<void> {
    const packets = (await this.retainedStore?.load()) ?? [];
    const messages = [...packets]
      .sort((a, b) => (a.replayOrder ?? 0) - (b.replayOrder ?? 0))
      .map((packet) => ({
        topic: packet.topic,
        payload: Buffer.from(packet.replayPayload ?? packet.payload).toString('utf8'),
        retained: true,
      }));
    let authoritative = true;
    for (const message of messages) {
      if (this.discoveryTopics.parse(message.topic))
        authoritative = (await this.discovery.handle(message)) && authoritative;
    }
    if (authoritative)
      await this.discovery.reconcile(packets.flatMap((packet) => packet.discoveryClaims ?? []));
    else this.logger.warn('mqtt_reconciliation_deferred');
    // Startup state is a snapshot, not a new physical event/automation trigger.
    for (const message of messages) await this.handleStateMessage(message, false);
  }

  private setupMqttSubscribers(): void {
    const stateListener = (msg: MqttMessage) => {
      this.messages = this.messages
        .then(async () => {
          if (this.discoveryTopics.parse(msg.topic)) await this.discovery.handle(msg);
          const writing = this.handleStateMessage(msg);
          this.stateWrites.add(writing);
          void writing.then(
            () => {
              this.stateWrites.delete(writing);
            },
            () => {
              this.stateWrites.delete(writing);
              this.logger.warn('mqtt_state_update_failed');
            },
          );
        })
        .catch(() => this.logger.warn('mqtt_message_failed'));
    };
    this.broker.on('message', stateListener);
    this.stopSubscribers.push(() => {
      this.broker.off('message', stateListener);
    });
  }

  private async handleStateMessage(msg: MqttMessage, dispatchTriggers = true): Promise<void> {
    const home = this.homeService;
    if (!home) return;

    const availabilityEndpoints = this.bindings.matchingAvailability(msg.topic);
    for (const endpointId of availabilityEndpoints ?? []) {
      const binding = this.bindings.get(endpointId);
      if (binding) await this.discovery.updateAvailability(binding, msg.topic, msg.payload);
    }

    const stateEndpoints = this.bindings.matching(msg.topic);
    const attributesEndpoints = this.bindings.matchingAttributes(msg.topic);
    const endpoints = new Set([...(stateEndpoints ?? []), ...(attributesEndpoints ?? [])]);
    if (endpoints.size) {
      await Promise.all(
        [...endpoints].map(async (endpointId) => {
          const binding = this.bindings.get(endpointId);
          if (!binding) return;
          const patch = stateEndpoints?.has(endpointId)
            ? extractEndpointStatePatch(binding, msg.payload)
            : {};
          if (attributesEndpoints?.has(endpointId)) {
            const result = extractJsonAttributes(binding, msg.payload);
            if (result.kind === 'valid') {
              patch.attributes = result.value;
            } else {
              const warningKey = `${endpointId}:${msg.topic}`;
              if (!this.warnedAttributes.has(warningKey)) {
                this.warnedAttributes.add(warningKey);
                this.logger.warn(
                  result.kind === 'unsupported'
                    ? 'mqtt_json_attributes_template_unsupported'
                    : 'mqtt_json_attributes_invalid',
                );
              }
            }
          }
          if (Object.keys(patch).length > 0) {
            await home.updateEndpointState(endpointId, patch, dispatchTriggers);
          }
        }),
      );
    }
  }

  private async handleDeviceCommand(
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<void> {
    const binding = this.bindings.get(endpointId);
    if (!binding) throw Error('mqtt_endpoint_unavailable');

    const messages = buildCommandMessages(binding, capability, command, parameters);
    for (const msg of messages) {
      await this.broker.publish({
        topic: msg.topic,
        payload: msg.payload,
        qos: 1,
      });
    }
  }
}
