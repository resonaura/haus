/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';

export { HaClient } from '@haus/ha/node/ha-client';

export class StandaloneHaClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.connected = false;
    this.stopped = false;
    this.inputRegistry = { states: [], entities: [] };
  }

  start() {
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
    this.connected = false;
  }

  async request() {
    throw new Error('ha_disconnected');
  }

  async registry() {
    return { states: [], entities: [], devices: [], areas: [] };
  }

  primaryRecordingInput() {
    return undefined;
  }

  async recordingInput() {
    return undefined;
  }

  async stream() {
    throw new Error('unsupported_stream_address');
  }

  async media() {
    throw new Error('unsupported_stream_address');
  }
}
