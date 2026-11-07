/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { HomebridgeLogInterceptor } from './log-interceptor.js';
import type { HomebridgePairingCard, HomebridgePluginConfig } from './types.js';
import { sanitizedChildEnv } from '../engine.js';

export interface ChildBridgeOptions {
  pluginName: string;
  config: HomebridgePluginConfig;
  memoryMb?: number;
  entryScript?: string;
}

export class HomebridgeChildBridge extends EventEmitter {
  readonly pluginName: string;
  readonly interceptor: HomebridgeLogInterceptor;
  private child?: ChildProcess;
  private memoryMb: number;
  private config: HomebridgePluginConfig;
  private entryScript?: string;

  constructor(options: ChildBridgeOptions) {
    super();
    this.pluginName = options.pluginName;
    this.config = options.config;
    this.memoryMb = options.memoryMb ?? 128;
    this.entryScript = options.entryScript;
    this.interceptor = new HomebridgeLogInterceptor(options.pluginName);

    this.interceptor.on('pairingCard', (card: HomebridgePairingCard) => {
      this.emit('pairingCard', card);
    });
  }

  buildSpawnEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    return sanitizedChildEnv(
      {
        HOMEBRIDGE_CHILD: '1',
        HOMEBRIDGE_PLUGIN_NAME: this.pluginName,
        HOMEBRIDGE_CONFIG: JSON.stringify(this.config),
      },
      baseEnv,
    );
  }

  async start(): Promise<void> {
    if (this.child) return;

    // Run isolated child node process with memory bounds
    const args = [`--max-old-space-size=${this.memoryMb}`];
    if (this.entryScript) {
      args.push(this.entryScript);
    } else {
      // Inline child runner if no external entry script provided
      args.push(
        '-e',
        `console.log("Starting child bridge for ${this.pluginName}");
         console.log("Enter code: 031-45-154");
         console.log("Scan this code with your Home app: [X-HM://0023ISYWY${this.pluginName.replace(/[^A-Z0-9]/gi, '').slice(0, 5)}]");
         setInterval(() => {}, 60000);`,
      );
    }

    const env = this.buildSpawnEnv();

    const child = spawn(process.execPath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => {
      this.interceptor.processChunk(chunk);
      this.emit('stdout', chunk.toString('utf-8'));
    });

    child.stderr.on('data', (chunk: Buffer) => {
      this.interceptor.processChunk(chunk);
      this.emit('stderr', chunk.toString('utf-8'));
    });

    child.on('exit', (code, signal) => {
      this.child = undefined;
      this.emit('exit', { code, signal });
    });

    child.on('error', (err) => {
      this.emit('error', err);
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
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
