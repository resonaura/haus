/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';
import type { HomebridgePairingCard } from './types.js';

export class HomebridgeLogInterceptor extends EventEmitter {
  private pinRegex = /\b(\d{3}-\d{2}-\d{3})\b/;
  private uriRegex = /(X-HM:\/\/[A-Z0-9]+)/i;
  private capturedCards = new Map<string, HomebridgePairingCard>();

  constructor(private readonly pluginName: string) {
    super();
  }

  processChunk(chunk: string | Buffer): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const lines = text.split('\n');
    for (const line of lines) {
      this.processLine(line);
    }
  }

  processLine(line: string): HomebridgePairingCard | undefined {
    const pinMatch = line.match(this.pinRegex);
    const uriMatch = line.match(this.uriRegex);

    if (pinMatch || uriMatch) {
      const existing = this.capturedCards.get(this.pluginName);
      const pin = pinMatch ? pinMatch[1] : existing?.pin;
      const setupUri = uriMatch ? uriMatch[1] : existing?.setupUri;

      const card: HomebridgePairingCard = {
        pluginName: this.pluginName,
        pin: pin ?? '000-00-000',
        setupUri,
        timestamp: new Date().toISOString(),
      };

      this.capturedCards.set(this.pluginName, card);
      this.emit('pairingCard', card);
      return card;
    }

    return undefined;
  }

  getCard(): HomebridgePairingCard | undefined {
    return this.capturedCards.get(this.pluginName);
  }
}
