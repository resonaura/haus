/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { sha256 } from './sha256.js';
import type { ProtocolKind } from './types.js';

export interface RadioNvramBackup {
  readonly id: string;
  readonly protocol: ProtocolKind;
  readonly coordinatorIeee: string;
  readonly panId: string;
  readonly extendedPanId: string;
  readonly channel: number;
  readonly networkKey: string;
  readonly networkUpdateId: number;
  readonly timestamp: number;
  readonly checksum: string;
}

export function computeNvramChecksum(backup: Omit<RadioNvramBackup, 'checksum'>): string {
  const payload = [
    backup.protocol,
    backup.coordinatorIeee.toLowerCase(),
    backup.panId.toLowerCase(),
    backup.extendedPanId.toLowerCase(),
    backup.channel.toString(),
    backup.networkKey.toLowerCase(),
    backup.networkUpdateId.toString(),
  ].join(':');

  return sha256(payload);
}

export function createNvramBackup(
  params: Omit<RadioNvramBackup, 'checksum' | 'id'> & { id?: string },
): RadioNvramBackup {
  const base = {
    id: params.id ?? `${params.protocol}-${params.coordinatorIeee}-${params.timestamp}`,
    protocol: params.protocol,
    coordinatorIeee: params.coordinatorIeee,
    panId: params.panId,
    extendedPanId: params.extendedPanId,
    channel: params.channel,
    networkKey: params.networkKey,
    networkUpdateId: params.networkUpdateId,
    timestamp: params.timestamp,
  };

  const checksum = computeNvramChecksum(base);
  return { ...base, checksum };
}

export function verifyNvramChecksum(backup: RadioNvramBackup): boolean {
  const expected = computeNvramChecksum(backup);
  return backup.checksum === expected;
}

export interface RadioNvramRepository {
  saveBackup(backup: RadioNvramBackup): Promise<void>;
  getLatestBackup(protocol: ProtocolKind): Promise<RadioNvramBackup | null>;
  listBackups(protocol?: ProtocolKind): Promise<RadioNvramBackup[]>;
}

export class InMemoryRadioNvramRepository implements RadioNvramRepository {
  private readonly backups = new Map<string, RadioNvramBackup>();

  public async saveBackup(backup: RadioNvramBackup): Promise<void> {
    if (!verifyNvramChecksum(backup)) {
      throw new Error(`Invalid NVRAM backup: checksum verification failed for ${backup.id}`);
    }
    this.backups.set(backup.id, backup);
  }

  public async getLatestBackup(protocol: ProtocolKind): Promise<RadioNvramBackup | null> {
    const matching = Array.from(this.backups.values())
      .filter((b) => b.protocol === protocol)
      .sort((a, b) => b.timestamp - a.timestamp);

    return matching[0] ?? null;
  }

  public async listBackups(protocol?: ProtocolKind): Promise<RadioNvramBackup[]> {
    const list = Array.from(this.backups.values());
    if (!protocol) return list.sort((a, b) => b.timestamp - a.timestamp);
    return list.filter((b) => b.protocol === protocol).sort((a, b) => b.timestamp - a.timestamp);
  }
}
