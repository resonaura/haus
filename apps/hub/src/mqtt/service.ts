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
  type HausMqttBrokerOptions,
  type MqttCommand,
  type MqttMessage,
} from '@haus/mqtt';
import type { Capability, HausDevice, HausEndpoint, SourceDeviceRef } from '@haus/core';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../home/home.service.js';
import { HAUS_MQTT_OPTIONS } from './tokens.js';
import type {
  DeviceBundleDiscoveryPayload,
  MqttEndpointBinding,
  SingleEntityDiscoveryPayload,
} from './types.js';

@Injectable()
export class MqttService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MqttService.name);
  public readonly broker: HausMqttBroker;
  private readonly endpointBindings = new Map<string, MqttEndpointBinding>();
  private readonly stateTopicToEndpoints = new Map<string, Set<string>>();
  private unregisterCommandHandler?: () => void;
  private isStarted = false;

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional()
    @Inject(HAUS_MQTT_OPTIONS)
    options?: HausMqttBrokerOptions,
  ) {
    const port = options?.port ?? Number(process.env.HAUS_MQTT_PORT || 1883);
    const host = options?.host ?? process.env.HAUS_MQTT_HOST ?? '0.0.0.0';
    const allowAnonymous = options?.allowAnonymous ?? process.env.HAUS_MQTT_ALLOW_ANON !== 'false';

    this.broker = new HausMqttBroker({
      port,
      host,
      allowAnonymous,
      username: options?.username ?? process.env.HAUS_MQTT_USER,
      password: options?.password ?? process.env.HAUS_MQTT_PASS,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.isStarted) return;
    try {
      const bound = await this.broker.listen();
      this.isStarted = true;
      this.logger.log(`Native Haus MQTT Broker listening on ${bound.host}:${bound.port}`);

      this.setupMqttSubscribers();

      if (this.homeService) {
        this.unregisterCommandHandler = this.homeService.registerCommandHandler(
          'mqtt',
          async (endpointId, capability, command, parameters) => {
            await this.handleDeviceCommand(endpointId, capability, command, parameters);
          },
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to start native Haus MQTT Broker: ${msg}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.unregisterCommandHandler?.();
    if (this.isStarted) {
      await this.broker.close();
      this.isStarted = false;
      this.logger.log('Native Haus MQTT Broker stopped.');
    }
  }

  async publish(command: MqttCommand): Promise<void> {
    return this.broker.publish(command);
  }

  private setupMqttSubscribers(): void {
    // 1. Multi-level wildcard subscriptions for Home Assistant and Haus discovery
    this.broker.subscribe('homeassistant/#', (msg) => {
      if (msg.topic.endsWith('/config')) {
        this.handleDiscovery(msg);
      }
    });
    this.broker.subscribe('haus/#', (msg) => {
      if (msg.topic.endsWith('/config')) {
        this.handleDiscovery(msg);
      }
    });

    // 2. Global message listener for state topics
    this.broker.on('message', (msg: MqttMessage) => {
      this.handleStateMessage(msg);
    });
  }

  private handleDiscovery(msg: MqttMessage): void {
    if (!this.homeService) return;

    const trimmed = msg.payload.trim();
    if (!trimmed) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.components && typeof parsed.components === 'object') {
        this.handleDeviceBundleDiscovery(parsed as unknown as DeviceBundleDiscoveryPayload);
        return;
      }
      this.handleSingleEntityDiscovery(msg.topic, parsed as unknown as SingleEntityDiscoveryPayload);
    } catch (err: unknown) {
      this.logger.warn(`Failed to parse discovery packet on ${msg.topic}: ${err}`);
    }
  }

  private handleSingleEntityDiscovery(topic: string, payload: SingleEntityDiscoveryPayload): void {
    const parts = topic.split('/');
    const component = parts[1] ?? 'switch';
    const objectId = parts.length >= 5 ? (parts[3] ?? 'object') : (parts[2] ?? 'object');
    const nodeId = parts.length >= 5 ? parts[2] : undefined;

    const uniqueId =
      payload.unique_id ||
      (nodeId ? `${component}_${nodeId}_${objectId}` : `${component}_${objectId}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const deviceId = `mqtt_${uniqueId}`;
    const endpointId = `ep_${deviceId}`;

    const devName = payload.device?.name;
    const rawName = payload.name;
    const name =
      rawName &&
      devName &&
      !rawName.toLowerCase().includes(devName.toLowerCase()) &&
      !devName.toLowerCase().includes(rawName.toLowerCase())
        ? `${devName} ${rawName}`
        : rawName || devName || `${component.toUpperCase()} ${objectId}`;

    const isJsonSchema = payload.schema === 'json';
    const isLight = component === 'light';
    const isSwitch = component === 'switch';
    const isSensor = component === 'sensor' || component === 'binary_sensor';

    const category = isLight
      ? 'lighting'
      : isSwitch
        ? 'power'
        : isSensor
          ? 'security'
          : 'appliances';

    const capabilities: Capability[] = [];
    if (isLight) {
      capabilities.push({
        id: 'on_off',
        kind: 'binary',
        readable: true,
        operations: payload.command_topic ? ['set', 'turn_on', 'turn_off'] : [],
      });
      if (payload.brightness) {
        capabilities.push({
          id: 'brightness',
          kind: 'numeric',
          readable: true,
          operations: payload.command_topic ? ['set'] : [],
        });
      }
      if (payload.color_mode || payload.supported_color_modes?.length) {
        capabilities.push({
          id: 'color',
          kind: 'complex',
          readable: true,
          operations: payload.command_topic ? ['set'] : [],
        });
      }
      if (payload.effect || payload.effect_list?.length) {
        capabilities.push({
          id: 'effect',
          kind: 'string',
          readable: true,
          operations: payload.command_topic ? ['set'] : [],
        });
      }
    } else if (isSwitch) {
      capabilities.push({
        id: 'power',
        kind: 'binary',
        readable: true,
        operations: payload.command_topic ? ['set', 'turn_on', 'turn_off'] : [],
      });
    } else {
      capabilities.push({
        id: 'state',
        kind: component === 'sensor' ? 'numeric' : 'binary',
        readable: true,
        operations: payload.command_topic ? ['set'] : [],
      });
    }

    const sourceRef: SourceDeviceRef = {
      protocol: 'mqtt',
      externalId: uniqueId,
    };

    const device: HausDevice = {
      id: deviceId,
      source: {
        instanceId: 'haus-mqtt',
        externalId: uniqueId,
      },
      name,
      category,
      roomId: 'unassigned',
      availability: 'online',
      connectivity: {
        protocol: 'mqtt',
      },
      manufacturer: payload.device?.manufacturer,
      model: payload.device?.model,
      firmwareVersion: payload.device?.sw_version,
      sourceRefs: [sourceRef],
      endpoints: [
        {
          id: endpointId,
          name,
          capabilities,
          readings: {},
        },
      ],
    };

    this.homeService!.registerDevice(device);

    const binding: MqttEndpointBinding = {
      endpointId,
      deviceId,
      isJsonSchema,
      stateTopic: payload.state_topic,
      commandTopic: payload.command_topic,
      payloadOn: payload.payload_on ?? 'ON',
      payloadOff: payload.payload_off ?? 'OFF',
    };

    this.endpointBindings.set(endpointId, binding);

    if (payload.state_topic) {
      this.bindStateTopic(payload.state_topic, endpointId);
    }

    this.logger.log(`Discovered MQTT device "${name}" (${deviceId})`);
  }

  private handleDeviceBundleDiscovery(payload: DeviceBundleDiscoveryPayload): void {
    const rawDevId = payload.device?.identifiers?.[0] || 'device';
    const deviceId = `mqtt_${rawDevId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const deviceName = payload.device?.name || rawDevId;

    const endpoints: HausEndpoint[] = [];

    for (const [compKey, comp] of Object.entries(payload.components)) {
      const uniqueId = comp.unique_id || `${rawDevId}_${compKey}`;
      const endpointId = `ep_${uniqueId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const epName = comp.name ? `${deviceName} ${comp.name}` : deviceName;

      const isJsonSchema = comp.schema === 'json';
      const isSwitch = comp.platform === 'switch';
      const isButton = comp.platform === 'button';
      const isLight = comp.platform === 'light';
      const isSensor = comp.platform === 'sensor' || comp.platform === 'binary_sensor';

      const capabilities: Capability[] = [
        {
          id: isLight ? 'on_off' : isSwitch ? 'power' : isButton ? 'press' : 'state',
          kind: isButton ? 'action' : isLight || isSwitch ? 'binary' : isSensor ? 'numeric' : 'complex',
          readable: !isButton,
          operations: comp.command_topic
            ? isButton
              ? ['press']
              : isLight || isSwitch
                ? ['set', 'turn_on', 'turn_off']
                : ['set']
            : [],
        },
      ];

      endpoints.push({
        id: endpointId,
        name: epName,
        capabilities,
        readings: {},
      });

      const binding: MqttEndpointBinding = {
        endpointId,
        deviceId,
        isJsonSchema,
        stateTopic: comp.state_topic,
        commandTopic: comp.command_topic,
        payloadOn: comp.payload_on ?? comp.payload_press ?? 'ON',
        payloadOff: comp.payload_off ?? 'OFF',
      };
      this.endpointBindings.set(endpointId, binding);

      if (comp.state_topic) {
        this.bindStateTopic(comp.state_topic, endpointId);
      }
    }

    const device: HausDevice = {
      id: deviceId,
      source: {
        instanceId: 'haus-mqtt',
        externalId: rawDevId,
      },
      name: deviceName,
      category: 'appliances',
      roomId: 'unassigned',
      availability: 'online',
      connectivity: { protocol: 'mqtt' },
      manufacturer: payload.device?.manufacturer,
      model: payload.device?.model,
      firmwareVersion: payload.device?.sw_version,
      sourceRefs: [{ protocol: 'mqtt', externalId: rawDevId }],
      endpoints,
    };

    this.homeService!.registerDevice(device);
    this.logger.log(
      `Discovered MQTT bundled device "${deviceName}" (${deviceId}) with ${endpoints.length} endpoints`,
    );
  }

  private bindStateTopic(topic: string, endpointId: string): void {
    let set = this.stateTopicToEndpoints.get(topic);
    if (!set) {
      set = new Set();
      this.stateTopicToEndpoints.set(topic, set);
    }
    set.add(endpointId);
  }

  private handleStateMessage(msg: MqttMessage): void {
    if (!this.homeService) return;
    const endpoints = this.stateTopicToEndpoints.get(msg.topic);
    if (!endpoints || endpoints.size === 0) return;

    let patch: Record<string, unknown> = {};
    const text = msg.payload.trim();

    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          patch = parsed as Record<string, unknown>;
        }
      } catch {}
    }

    if (Object.keys(patch).length === 0) {
      const upper = text.toUpperCase();
      if (upper === 'ON' || upper === 'TRUE' || upper === '1') {
        patch = { state: 'on', on_off: true, power: true };
      } else if (upper === 'OFF' || upper === 'FALSE' || upper === '0') {
        patch = { state: 'off', on_off: false, power: false };
      } else {
        const num = Number(text);
        patch = isNaN(num) ? { state: text } : { state: num, value: num };
      }
    } else {
      if (typeof patch.state === 'string') {
        const upper = patch.state.toUpperCase();
        if (upper === 'ON') {
          patch.state = 'on';
          patch.on_off = true;
          patch.power = true;
        } else if (upper === 'OFF') {
          patch.state = 'off';
          patch.on_off = false;
          patch.power = false;
        }
      }
      if (patch.current_temperature !== undefined && patch.temperature === undefined) {
        patch.temperature = patch.current_temperature;
      }
    }

    for (const endpointId of endpoints) {
      void this.homeService.updateEndpointState(endpointId, patch, true);
    }
  }

  private async handleDeviceCommand(
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<void> {
    const binding = this.endpointBindings.get(endpointId);
    if (!binding || !binding.commandTopic) return;

    let payload: string;
    if (binding.isJsonSchema) {
      if (command === 'turn_on') {
        const body: Record<string, unknown> = { state: 'ON' };
        if (parameters) {
          Object.assign(body, parameters);
        }
        payload = JSON.stringify(body);
      } else if (command === 'turn_off') {
        payload = JSON.stringify({ state: 'OFF' });
      } else if (command === 'set') {
        const body: Record<string, unknown> = {};
        if (parameters?.state !== undefined) body.state = parameters.state;
        if (parameters?.brightness !== undefined) body.brightness = parameters.brightness;
        if (parameters?.color !== undefined) body.color = parameters.color;
        if (parameters?.effect !== undefined) body.effect = parameters.effect;
        if (parameters?.value !== undefined && Object.keys(body).length === 0) {
          Object.assign(
            body,
            typeof parameters.value === 'object' && parameters.value !== null
              ? (parameters.value as Record<string, unknown>)
              : { value: parameters.value },
          );
        }
        payload = JSON.stringify(body);
      } else {
        payload = JSON.stringify({ state: command, ...parameters });
      }
    } else {
      if (command === 'turn_on') {
        payload = binding.payloadOn;
      } else if (command === 'turn_off') {
        payload = binding.payloadOff;
      } else if (command === 'press') {
        payload = binding.payloadOn;
      } else if (parameters?.value !== undefined) {
        payload = typeof parameters.value === 'string'
          ? parameters.value
          : JSON.stringify(parameters.value);
      } else {
        payload = command;
      }
    }

    await this.broker.publish({
      topic: binding.commandTopic,
      payload,
      qos: 1,
    });
  }
}
