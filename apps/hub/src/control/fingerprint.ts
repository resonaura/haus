/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHmac, createSecretKey, hkdfSync } from 'node:crypto';
import type { Command } from '@haus/core/types';
import { canonical } from './canonical.js';

export class Fingerprints {
  private readonly key;
  constructor(
    master: Uint8Array,
    private readonly homeId: string,
  ) {
    const derived = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'haus.command.v1', 32));
    try {
      this.key = createSecretKey(derived);
    } finally {
      derived.fill(0);
    }
  }

  digest(intent: Omit<Command, 'id'>): string {
    const payload = canonical({
      homeId: this.homeId,
      endpointId: intent.endpointId,
      capabilityId: intent.capabilityId,
      operation: intent.operation,
      arguments: { ...intent.arguments },
    });
    return createHmac('sha256', this.key).update(payload).digest('hex');
  }
}
