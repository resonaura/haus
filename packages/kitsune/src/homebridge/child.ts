/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HausDevice } from '@haus/core/device';
import { HomebridgeLogInterceptor } from './log-interceptor.js';
import type { HomebridgePairingCard, HomebridgePluginConfig } from './types.js';
import {
  sanitizedChildEnv,
  type KitsuneCommandPayload,
  type UnsupportedCapability,
} from '../engine.js';
import { resolveHomebridgeBleEnvironment, resolveSharedNodeModulesPaths } from './ble-env.js';
import {
  HOMEBRIDGE_GOVEE_PACKAGE,
  resolveHomebridgeGoveePluginDirectory,
} from './govee-catalog.js';

export interface ChildBridgeOptions {
  pluginName: string;
  config: HomebridgePluginConfig;
  memoryMb?: number;
  entryScript?: string;
  storagePath?: string;
  pluginPath?: string;
  dataDirectory?: string;
}

export class HomebridgeChildBridge extends EventEmitter {
  readonly pluginName: string;
  readonly interceptor: HomebridgeLogInterceptor;
  private child?: ChildProcess;
  private memoryMb: number;
  private config: HomebridgePluginConfig;
  private entryScript?: string;
  private storagePath?: string;
  private pluginPath?: string;
  private dataDirectory?: string;
  private messageCounter = 0;
  private pendingCommands = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(options: ChildBridgeOptions) {
    super();
    this.pluginName = options.pluginName;
    this.config = options.config;
    this.memoryMb = options.memoryMb ?? 128;
    this.entryScript = options.entryScript;
    this.storagePath = options.storagePath;
    this.pluginPath = options.pluginPath;
    this.dataDirectory = options.dataDirectory;
    this.interceptor = new HomebridgeLogInterceptor(options.pluginName);

    this.interceptor.on('pairingCard', (card: HomebridgePairingCard) => {
      this.emit('pairingCard', card);
    });
  }

  buildSpawnEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const custom: Record<string, string> = {
      HOMEBRIDGE_CHILD: '1',
      HOMEBRIDGE_PLUGIN_NAME: this.pluginName,
      HOMEBRIDGE_CONFIG: JSON.stringify(this.config),
    };
    if (this.storagePath) custom.HOMEBRIDGE_STORAGE_PATH = this.storagePath;
    if (this.pluginPath) custom.HOMEBRIDGE_PLUGIN_PATH = this.pluginPath;

    const sharedNodeModules = resolveSharedNodeModulesPaths();
    const existingNodePath = baseEnv.NODE_PATH ? [baseEnv.NODE_PATH] : [];
    const nodePaths = [...sharedNodeModules, ...existingNodePath].filter(Boolean);
    if (nodePaths.length > 0) {
      custom.NODE_PATH = nodePaths.join(delimiter);
    }

    const bleEnv = resolveHomebridgeBleEnvironment({ env: baseEnv });
    for (const [k, v] of Object.entries(bleEnv.envOverrides)) {
      if (!baseEnv[k]) custom[k] = v;
    }
    if (baseEnv.DBUS_SYSTEM_BUS_ADDRESS) {
      custom.DBUS_SYSTEM_BUS_ADDRESS = baseEnv.DBUS_SYSTEM_BUS_ADDRESS;
    } else if (bleEnv.mode === 'dbus') {
      custom.DBUS_SYSTEM_BUS_ADDRESS = 'unix:path=/run/dbus/system_bus_socket';
    }
    if (baseEnv.NOBLE_HCI_DEVICE_ID) {
      custom.NOBLE_HCI_DEVICE_ID = baseEnv.NOBLE_HCI_DEVICE_ID;
    }

    return sanitizedChildEnv(custom, baseEnv);
  }

  async start(): Promise<void> {
    if (this.child) return;

    if (
      !this.pluginPath &&
      (this.pluginName === HOMEBRIDGE_GOVEE_PACKAGE ||
        this.pluginName === 'homebridge-govee' ||
        this.pluginName === 'govee')
    ) {
      const searchRoots = this.storagePath
        ? [dirname(this.storagePath), join(dirname(this.storagePath), 'plugins')]
        : [];
      this.pluginPath = await resolveHomebridgeGoveePluginDirectory({
        dataDirectory: this.dataDirectory,
        searchRoots,
      });
    }

    const args = [`--max-old-space-size=${this.memoryMb}`];
    if (this.entryScript) {
      args.push(this.entryScript);
    } else {
      const localJs = fileURLToPath(new URL('./runner.js', import.meta.url));
      const distJs = fileURLToPath(new URL('../../dist/homebridge/runner.js', import.meta.url));
      const runnerPath = existsSync(localJs) ? localJs : existsSync(distJs) ? distJs : undefined;
      if (runnerPath) {
        args.push(runnerPath);
      } else {
        const pin =
          (typeof (this.config._bridge as Record<string, unknown>)?.pin === 'string'
            ? ((this.config._bridge as Record<string, unknown>).pin as string)
            : undefined) ??
          (typeof this.config.pin === 'string' ? (this.config.pin as string) : undefined) ??
          (this.pluginName === 'homebridge-sample' ? '031-45-154' : undefined);

        const codeLog = pin ? `console.log("Enter code: ${pin}");` : '';
        const uriLog = pin
          ? `console.log("Scan this code with your Home app: [X-HM://0023ISYWY${this.pluginName.replace(/[^A-Z0-9]/gi, '').slice(0, 5)}]");`
          : '';
        args.push(
          '-e',
          `console.log("Starting child bridge for ${this.pluginName}");
           ${codeLog}
           ${uriLog}
           setInterval(() => {}, 60000);`,
        );
      }
    }

    const env = this.buildSpawnEnv();

    const child = spawn(process.execPath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    this.child = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      this.interceptor.processChunk(chunk);
      this.emit('stdout', chunk.toString('utf-8'));
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      this.interceptor.processChunk(chunk);
      this.emit('stderr', chunk.toString('utf-8'));
    });

    child.on('message', (input: unknown) => {
      const msg = input as {
        type?: string;
        id?: number;
        result?: unknown;
        error?: string;
        devices?: HausDevice[];
        deviceId?: string;
        readings?: unknown;
        item?: Omit<UnsupportedCapability, 'reportedAt'>;
      };
      if (msg.type === 'result' && typeof msg.id === 'number') {
        const pending = this.pendingCommands.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCommands.delete(msg.id);
          pending.resolve(msg.result);
        }
      } else if (msg.type === 'error' && typeof msg.id === 'number') {
        const pending = this.pendingCommands.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCommands.delete(msg.id);
          pending.reject(new Error(msg.error ?? 'kitsune_command_failed'));
        }
      } else if (msg.type === 'devices' && Array.isArray(msg.devices)) {
        this.emit('devicesChanged', msg.devices);
      } else if (msg.type === 'state' && msg.deviceId) {
        this.emit('deviceStateChanged', msg.deviceId, msg.readings);
      } else if (msg.type === 'unsupportedCapability' && msg.item) {
        this.emit('unsupportedCapability', msg.item);
      }
    });

    child.on('exit', (code, signal) => {
      this.child = undefined;
      for (const pending of this.pendingCommands.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('kitsune_bridge_exited'));
      }
      this.pendingCommands.clear();
      this.emit('exit', { code, signal });
    });

    child.on('error', (err) => {
      this.emit('error', err);
    });
  }

  async executeCommand(command: KitsuneCommandPayload): Promise<unknown> {
    if (!this.child || !this.child.connected) {
      throw new Error('kitsune_child_bridge_not_running');
    }
    const id = ++this.messageCounter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error('kitsune_command_timeout'));
      }, 10000);
      this.pendingCommands.set(id, { resolve, reject, timer });
      this.child?.send({ type: 'command', id, command });
    });
  }

  async getDevices(): Promise<HausDevice[]> {
    if (!this.child || !this.child.connected) return [];
    const id = ++this.messageCounter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error('kitsune_command_timeout'));
      }, 5000);
      this.pendingCommands.set(id, {
        resolve: (val: unknown) => resolve((val as HausDevice[]) ?? []),
        reject,
        timer,
      });
      this.child?.send({ type: 'getDevices', id });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('kitsune_bridge_stopped'));
    }
    this.pendingCommands.clear();
    if (!child || child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
}
