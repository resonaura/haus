/*
 * Haus — A thoughtful home for Haus Hub.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface SettingsState {
  storageLimitBytes: number | null;
}

export interface SettingsStatus {
  storageLimitBytes: number | null;
  source: string;
}

export interface NodeSettingsOptions {
  environmentLimit?: number | null;
  apply?: (bytes: number | null, source: string) => void;
}

export function storageLimitFromEnvironment(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  if (Number(value) === 0) return null;
  const bytes = Number(value) * 1024 ** 3;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Invalid storage budget');
  return bytes;
}

function validate(input: unknown): SettingsState {
  if (
    !isRecord(input) ||
    Object.keys(input).length !== 1 ||
    !Object.hasOwn(input, 'storageLimitBytes')
  )
    throw new Error('invalid_settings');
  const limit = input.storageLimitBytes;
  const numeric =
    typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0 ? limit : null;
  if (limit !== null && numeric === null) throw new Error('invalid_settings');
  return { storageLimitBytes: numeric };
}

/** A user policy supersedes an explicit environment cap, including null/unlimited. */
export class NodeSettings {
  readonly file: string;
  value: SettingsState;
  source: string;
  private readonly apply: (bytes: number | null, source: string) => void;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    file: string,
    { environmentLimit = null, apply = () => {} }: NodeSettingsOptions = {},
  ) {
    this.file = file;
    this.value = { storageLimitBytes: environmentLimit };
    this.source = environmentLimit === null ? 'default' : 'environment';
    this.apply = apply;
  }

  async initialize(): Promise<this> {
    try {
      this.value = validate(JSON.parse(await readFile(this.file, 'utf8')));
      this.source = 'user';
    } catch (error) {
      // An unreadable policy must never silently drop an explicitly configured cap.
      if (!isErrNoent(error)) throw error;
    }
    this.apply(this.value.storageLimitBytes, this.source);
    return this;
  }

  status(): SettingsStatus {
    return { ...this.value, source: this.source };
  }

  async update(input: unknown): Promise<SettingsStatus> {
    const value = validate(input);
    const operation = this.pending.then(async () => {
      const temporary = join(dirname(this.file), `.settings-${randomUUID()}`);
      let file: Awaited<ReturnType<typeof open>> | undefined;
      try {
        file = await open(temporary, 'wx', 0o600);
        await file.writeFile(`${JSON.stringify(value)}\n`);
        await file.sync();
        await file.close();
        file = undefined;
        await rename(temporary, this.file);
        // Directory fsync is supported on Linux/macOS, but not all Windows volumes.
        const directory = await open(dirname(this.file), 'r').catch(() => null);
        if (directory) {
          try {
            await directory.sync().catch(() => {});
          } finally {
            await directory.close();
          }
        }
        this.value = value;
        this.source = 'user';
        this.apply(value.storageLimitBytes, 'user');
        return this.status();
      } finally {
        await file?.close();
        await unlink(temporary).catch(() => {});
      }
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}

function isErrNoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
