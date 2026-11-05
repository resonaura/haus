/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import mqtt, { type MqttClient as RawMqttClient, type IClientOptions } from 'mqtt';
import type { MqttCommand, MqttConnectionInfo, MqttMessage, MqttMessageHandler } from './types.js';
import { MqttTopicRouter } from './router.js';

export interface HausMqttClientOptions extends IClientOptions {
  readonly autoConnect?: boolean;
}

/**
 * Haus Native MQTT Client backed by the battle-tested 'mqtt' library.
 * Provides resilient auto-reconnect, QoS tracking, and wildcard topic routing.
 */
export class HausMqttClient {
  private client?: RawMqttClient;
  private readonly router = new MqttTopicRouter();
  private isConnected = false;

  constructor(private readonly connectionInfo: MqttConnectionInfo) {}

  get connected(): boolean {
    return this.isConnected;
  }

  async connect(options?: HausMqttClientOptions): Promise<void> {
    if (this.client && this.isConnected) return;

    const protocol = this.connectionInfo.port === 8883 ? 'mqtts' : 'mqtt';
    const brokerUrl = `${protocol}://${this.connectionInfo.host}:${this.connectionInfo.port}`;

    const clientOptions: IClientOptions = {
      username: this.connectionInfo.username,
      password: this.connectionInfo.password,
      reconnectPeriod: 2000,
      connectTimeout: 10000,
      clean: true,
      ...options,
    };

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(brokerUrl, clientOptions);

      this.client.once('connect', () => {
        this.isConnected = true;
        resolve();
      });

      this.client.once('error', (err) => {
        if (!this.isConnected) {
          reject(err);
        }
      });

      this.client.on('connect', () => {
        this.isConnected = true;
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });

      this.client.on('message', (topic, payload, packet) => {
        const message: MqttMessage = {
          topic,
          payload: payload.toString('utf8'),
          retained: packet.retain,
          qos: packet.qos as 0 | 1 | 2,
          timestamp: Date.now(),
        };
        void this.router.dispatch(message);
      });
    });
  }

  async subscribe(topicFilter: string, handler: MqttMessageHandler): Promise<() => void> {
    const unsubscribeRouter = this.router.subscribe(topicFilter, handler);

    if (this.client && this.isConnected) {
      await new Promise<void>((resolve, reject) => {
        this.client!.subscribe(topicFilter, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    return () => {
      unsubscribeRouter();
      if (this.client && this.isConnected) {
        this.client.unsubscribe(topicFilter);
      }
    };
  }

  async publish(command: MqttCommand): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('mqtt_client_not_connected');
    }

    return new Promise<void>((resolve, reject) => {
      this.client!.publish(
        command.topic,
        command.payload,
        { qos: command.qos ?? 0, retain: command.retain ?? false },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;

    return new Promise((resolve) => {
      this.client!.end(false, {}, () => {
        this.isConnected = false;
        this.client = undefined;
        resolve();
      });
    });
  }
}
