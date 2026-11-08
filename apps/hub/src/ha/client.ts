/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';

export { HaClient } from '@haus/ha/node/ha-client';

export class StandaloneHaClient extends EventEmitter {
  config: Record<string, unknown>;
  connected = false;
  stopped = false;
  inputRegistry = { states: [] as unknown[], entities: [] as unknown[] };

  constructor(config: Record<string, unknown> = {}) {
    super();
    this.config = config;
  }

  start(): void {
    this.stopped = false;
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
  }

  async request(_message?: Record<string, unknown>): Promise<never> {
    throw new Error('ha_disconnected');
  }

  async registry(): Promise<{
    states: never[];
    entities: never[];
    devices: never[];
    areas: never[];
  }> {
    return { states: [], entities: [], devices: [], areas: [] };
  }

  primaryRecordingInput(): undefined {
    return undefined;
  }

  async recordingInput(): Promise<undefined> {
    return undefined;
  }

  async stream(): Promise<never> {
    throw new Error('unsupported_stream_address');
  }

  async media(): Promise<never> {
    throw new Error('unsupported_stream_address');
  }

  async snapshot(): Promise<never> {
    throw new Error('ha_disconnected');
  }

  async migrationScene(): Promise<never> {
    throw new Error('ha_disconnected');
  }
}
