/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Aedes } from 'aedes';
import { createServer, type Server } from 'node:net';
import { EventEmitter } from 'node:events';
import type { MqttCommand, MqttConnectionInfo, MqttMessage, MqttMessageHandler } from './types.js';
import { MqttTopicRouter } from './router.js';
import type { RetainedStore } from './retention.js';

export interface HausMqttConfig {
  readonly host?: string;
  readonly port?: number;
  readonly allowAnonymous?: boolean;
  readonly username?: string;
  readonly password?: string;
  readonly dataDirectory?: string;
  readonly passwordFilePath?: string;
  readonly users?: readonly { username: string; passwordHash: string }[];
  readonly persistence?: boolean;
  readonly maxConnections?: number;
}

export interface HausMqttBrokerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly allowAnonymous?: boolean;
  readonly username?: string;
  readonly password?: string;
  readonly retainedStore?: RetainedStore;
}

/**
 * Native in-process MQTT broker powered by Aedes.
 * Eliminates external broker container dependencies, providing in-memory and TCP MQTT
 * pub/sub directly within Haus Hub.
 */
export class HausMqttBroker extends EventEmitter {
  private aedesInstance?: Aedes;
  private readonly router = new MqttTopicRouter();
  private server?: Server;
  private currentPort: number;
  private currentHost: string;
  private readonly allowAnonymous: boolean;
  private readonly username?: string;
  private readonly password?: string;
  private isListening = false;
  private readonly retainedStore?: RetainedStore;
  private readonly authenticatedClients = new WeakSet<object>();
  private starting?: Promise<Aedes>;
  private closing?: Promise<void>;

  constructor(options: HausMqttBrokerOptions = {}) {
    super();
    this.currentPort = options.port ?? 1883;
    this.currentHost = options.host ?? '0.0.0.0';
    this.allowAnonymous = options.allowAnonymous ?? true;
    this.username = options.username;
    this.password = options.password;
    this.retainedStore = options.retainedStore;
  }

  get listening(): boolean {
    return this.isListening;
  }

  get port(): number {
    return this.currentPort;
  }

  get host(): string {
    return this.currentHost;
  }

  get connectedClients(): number {
    return this.aedesInstance?.connectedClients ?? 0;
  }

  private ensureAedes(): Promise<Aedes> {
    if (this.aedesInstance) return Promise.resolve(this.aedesInstance);
    this.starting ??= this.createAedes().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async createAedes(): Promise<Aedes> {
    const instance = await Aedes.createBroker();

    try {
      for (const packet of (await this.retainedStore?.load()) ?? []) {
        await new Promise<void>((resolve, reject) =>
          instance.publish(
            {
              cmd: 'publish',
              topic: packet.topic,
              payload: Buffer.from(packet.payload),
              qos: packet.qos,
              retain: true,
              dup: false,
            },
            (error) => (error ? reject(error) : resolve()),
          ),
        );
      }
    } catch {
      await new Promise<void>((resolve) => instance.close(resolve));
      throw Error('mqtt_retained_restore_failed');
    }

    const authorize = instance.authorizePublish.bind(instance);
    instance.authorizePublish = (client, packet, callback) => {
      authorize(client, packet, (error) => {
        if (error || !packet.retain || !this.retainedStore) return callback(error);
        // QoS 1 PUBACK precedes Aedes' publish event; commit before authorizing the packet.
        void this.retainedStore
          .save({ topic: packet.topic, payload: Buffer.from(packet.payload), qos: packet.qos })
          .then(
            () => callback(null),
            () => callback(Error('mqtt_retained_write_failed')),
          );
      });
    };

    if (!this.allowAnonymous && this.username && this.password) {
      const expectedUser = this.username;
      const expectedPass = this.password;
      instance.authenticate = (client, username, password, callback) => {
        const pass = password ? password.toString('utf8') : '';
        const authorized = username === expectedUser && pass === expectedPass;
        if (authorized) this.authenticatedClients.add(client);
        callback(null, authorized);
      };
    }

    instance.on('publish', (packet, client) => {
      if (packet && packet.topic && !packet.topic.startsWith('$SYS/')) {
        const payloadStr = Buffer.isBuffer(packet.payload)
          ? packet.payload.toString('utf8')
          : String(packet.payload ?? '');
        const message: MqttMessage = {
          topic: packet.topic,
          payload: payloadStr,
          retained: Boolean(packet.retain),
          qos: packet.qos as 0 | 1 | 2,
          timestamp: Date.now(),
          authenticated: client !== null && this.authenticatedClients.has(client),
          duplicate: Boolean(packet.dup),
        };
        void this.router.dispatch(message);
        this.emit('message', message);
      }
    });

    this.aedesInstance = instance;
    return instance;
  }

  async listen(port?: number, host?: string): Promise<{ port: number; host: string }> {
    if (this.closing) await this.closing;
    if (this.server && this.isListening) {
      return { port: this.currentPort, host: this.currentHost };
    }
    if (port !== undefined) this.currentPort = port;
    if (host !== undefined) this.currentHost = host;

    const aedes = await this.ensureAedes();

    return new Promise<{ port: number; host: string }>((resolve, reject) => {
      this.server = createServer(aedes.handle);

      this.server.once('error', (err) => {
        if (!this.isListening) {
          reject(err);
        }
      });

      this.server.listen(this.currentPort, this.currentHost, () => {
        this.isListening = true;
        const addr = this.server?.address();
        if (typeof addr === 'object' && addr) {
          this.currentPort = addr.port;
        }
        resolve({ port: this.currentPort, host: this.currentHost });
      });
    });
  }

  subscribe(topicFilter: string, handler: MqttMessageHandler): () => void {
    return this.router.subscribe(topicFilter, handler);
  }

  async publish(command: MqttCommand): Promise<void> {
    if (!command.topic || /[+#\0]/.test(command.topic) || Buffer.byteLength(command.topic) > 65535)
      throw Error('mqtt_invalid_publish_topic');
    const aedes = await this.ensureAedes();
    if (command.retain && this.retainedStore) {
      try {
        await this.retainedStore.save({
          topic: command.topic,
          payload: Buffer.from(command.payload),
          qos: command.qos ?? 0,
        });
      } catch {
        throw Error('mqtt_retained_write_failed');
      }
    }
    return new Promise<void>((resolve, reject) => {
      aedes.publish(
        {
          cmd: 'publish',
          topic: command.topic,
          payload: Buffer.from(command.payload, 'utf8'),
          qos: command.qos ?? 0,
          retain: command.retain ?? false,
          dup: false,
        },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    const task = this.closeOwned().finally(() => {
      this.closing = undefined;
    });
    this.closing = task;
    return task;
  }

  private async closeOwned(): Promise<void> {
    if (this.starting) await this.starting;
    return new Promise<void>((resolve, reject) => {
      if (!this.aedesInstance) {
        this.isListening = false;
        return resolve();
      }

      this.aedesInstance.close(() => {
        if (this.server) {
          this.server.close((serverErr) => {
            this.isListening = false;
            this.server = undefined;
            this.aedesInstance = undefined;
            // A failed bind never owned a listening socket; shutdown is already complete.
            if (serverErr && !('code' in serverErr && serverErr.code === 'ERR_SERVER_NOT_RUNNING'))
              reject(serverErr);
            else resolve();
          });
        } else {
          this.isListening = false;
          this.aedesInstance = undefined;
          resolve();
        }
      });
    });
  }
}

/**
 * Generates secure, least-privilege, OS-agnostic Mosquitto broker configuration.
 * Paths are strictly injected by caller / host environment, never hardcoded.
 */
export function generateMosquittoConfig(config: HausMqttConfig = {}): string {
  const port = config.port ?? 1883;
  const allowAnon = config.allowAnonymous ?? false;
  const persistence = config.persistence ?? true;

  const lines = [
    '# Haus Native MQTT Broker Configuration',
    '# Managed automatically by Haus — do not edit directly.',
    `listener ${port} 0.0.0.0`,
    `allow_anonymous ${allowAnon}`,
    `persistence ${persistence}`,
    'log_dest stdout',
    'log_type error',
    'log_type warning',
    'log_type notice',
    'log_type information',
  ];

  if (persistence && config.dataDirectory) {
    const normalizedDataDir = config.dataDirectory.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    lines.push(`persistence_location ${normalizedDataDir}`);
  }

  if (config.passwordFilePath) {
    const normalizedPassPath = config.passwordFilePath.replace(/\\/g, '/');
    lines.push(`password_file ${normalizedPassPath}`);
  }

  if (config.maxConnections && config.maxConnections > 0) {
    lines.push(`max_connections ${config.maxConnections}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Normalizes MQTT connection details into standard connection info.
 */
export function resolveMqttConnectionInfo(config: HausMqttConfig = {}): MqttConnectionInfo {
  return {
    host: config.host ?? '127.0.0.1',
    port: config.port ?? 1883,
    allowAnonymous: config.allowAnonymous ?? false,
    username: config.username,
    password: config.password,
  };
}
