/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { safeStorage } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TerminalKeyStorePort } from '@haus/ipc/client';

const FILE_NAME = 'server-hub-keys.enc';

/**
 * Pins verified Hub Ed25519 identity fingerprints per (homeId, targetHubId) in OS-encrypted
 * storage so any unexpected Hub identity key rotation or MITM is caught immediately.
 */
export class HubKeyStore implements TerminalKeyStorePort {
  private writes: Promise<void> = Promise.resolve();
  private memoryFallback = new Map<string, string>();

  constructor(private readonly directory: string) {}

  private keyFor(homeId: string, targetHubId: string): string {
    return `${homeId}\0${targetHubId}`;
  }

  private encryptionReady(): boolean {
    try {
      return (
        safeStorage.isEncryptionAvailable() &&
        !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
      );
    } catch {
      return false;
    }
  }

  private async loadAll(): Promise<Record<string, string>> {
    if (!this.encryptionReady()) {
      return Object.fromEntries(this.memoryFallback);
    }
    try {
      const bytes = await readFile(join(this.directory, FILE_NAME));
      const parsed = JSON.parse(safeStorage.decryptString(bytes)) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) clean[key] = value;
      }
      return clean;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      return {};
    }
  }

  async getPinned(homeId: string, targetHubId: string): Promise<string | undefined> {
    const all = await this.loadAll();
    return all[this.keyFor(homeId, targetHubId)];
  }

  async pin(homeId: string, targetHubId: string, fingerprintHex: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(fingerprintHex)) return;
    const mapKey = this.keyFor(homeId, targetHubId);
    this.memoryFallback.set(mapKey, fingerprintHex);
    if (!this.encryptionReady()) return;
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        const all = await this.loadAll();
        if (all[mapKey] === fingerprintHex) return;
        all[mapKey] = fingerprintHex;
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = join(this.directory, `.server-hub-keys-${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, safeStorage.encryptString(JSON.stringify(all)), {
            flag: 'wx',
            mode: 0o600,
          });
          await rename(temporary, join(this.directory, FILE_NAME));
        } finally {
          await rm(temporary, { force: true });
        }
      });
    this.writes = operation;
    await operation;
  }
}
