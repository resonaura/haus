/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { supervisorBackup } from '@haus/ha/node/supervisor-backup';
import {
  CATALOG_SNAPSHOT,
  fileDigest,
  restoreCatalog,
  seal,
  unseal,
} from './backups.service.js';
import type { BackupCatalog } from './catalog.js';
import type { BackupRetryRow, BackupRow } from '../storage/entities/domains.js';

export { CATALOG_SNAPSHOT, fileDigest, restoreCatalog, seal, unseal };

const runCommand = promisify(execFile);

export interface BackupsConfig {
  data: string;
  token?: string | null;
  standalone?: boolean;
  ha_backups_enabled?: boolean;
}

export interface BackupsStore {
  archiveGeneration(): Promise<number>;
}

export interface BackupListItem extends BackupRow {
  available: boolean;
}

export class Backups {
  config: BackupsConfig;
  store: BackupsStore;
  catalog: BackupCatalog;
  root: string;
  running = new Map<string, Promise<BackupListItem | undefined>>();
  pruning = new Map<string, Promise<unknown>>();
  errors = new Map<string, string>();
  missing = new Set<string>();
  abort = new AbortController();
  lastConfigVersion = 0;
  key!: Buffer;
  dirtyAt?: number;

  constructor(config: BackupsConfig, store: BackupsStore, catalog?: BackupCatalog) {
    this.config = config;
    this.store = store;
    if (!catalog) throw new Error('backup_catalog_required');
    this.catalog = catalog;
    this.root = join(config.data, 'backups');
  }

  async initialize(): Promise<void> {
    await this.catalog.initialize();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = join(this.config.data, 'backup.key');
    try {
      this.key = Buffer.from((await readFile(path, 'utf8')).trim(), 'hex');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') throw error;
      this.key = randomBytes(32);
      await writeFile(path, this.key.toString('hex'), {
        mode: 0o600,
        flag: 'wx',
      });
    }
    if (this.key.length !== 32) throw new Error('invalid_backup_key');
    for (const item of this.list())
      if (!(await stat(this.path(item.digest)).catch(() => null)))
        this.missing.add(item.digest);
  }

  list(): BackupListItem[] {
    return this.catalog
      .list()
      .map((item) => ({ ...item, available: !this.missing.has(item.digest) }));
  }

  retry(kind: string): BackupRetryRow | undefined {
    return this.catalog.retry(kind);
  }

  path(digest: string): string {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('invalid_backup');
    return join(this.root, digest + '.enc');
  }

  recoveryKit(): { version: number; key: string; instructions: string } {
    return {
      version: 1,
      key: this.key.toString('hex'),
      instructions:
        'Keep this key offline. Use haus-nvr recover with a .enc backup. It is never sent to worker nodes.',
    };
  }

  get busy(): boolean {
    return this.running.size > 0;
  }

  get error(): string | undefined {
    return [...this.errors.values()].at(-1);
  }

  canSnapshot(kind = 'haus'): boolean {
    return !this.abort.signal.aborted && !this.running.has(kind);
  }

  snapshot(kind = 'haus'): Promise<BackupListItem | undefined> {
    if (!['haus', 'ha'].includes(kind))
      return Promise.reject(new Error('invalid_backup_kind'));
    if (!this.canSnapshot(kind))
      return Promise.reject(new Error('backup_busy'));
    // A slow Supervisor archive must not block the small recovery catalog
    // needed to evict already-verified local video. At most one of each kind.
    const task = Promise.resolve()
      .then(() => this.createSnapshot(kind))
      .finally(() => {
        this.running.delete(kind);
      });
    this.running.set(kind, task);
    return task;
  }

  async createSnapshot(kind = 'haus'): Promise<BackupListItem | undefined> {
    if (!['haus', 'ha'].includes(kind)) throw new Error('invalid_backup_kind');
    this.abort.signal.throwIfAborted();
    let directory: string | undefined;
    const createdAt = Date.now();
    const dirtyAt = this.dirtyAt;
    let haSlug: string | undefined;
    let archiveGeneration: number | null = null;
    try {
      directory = await mkdtemp(join(this.root, '.work-'));
      let source: NodeJS.ReadableStream;
      if (kind === 'haus') {
        archiveGeneration = await this.store.archiveGeneration();
        await this.catalog.snapshotDatabase(join(directory, 'haus.sqlite'));
        const options = await readFile(
          join(this.config.data, 'options.json'),
          'utf8',
        ).catch(() => '{}');
        await writeFile(join(directory, 'options.json'), options, {
          mode: 0o600,
        });
        await copyFile(
          join(this.config.data, 'backup.key'),
          join(directory, 'backup.key'),
        );
        const archive = join(directory, 'haus.tar.gz');
        const homekit = await stat(join(this.config.data, 'homekit')).catch(() => null);
        if (homekit?.isDirectory())
          await cp(join(this.config.data, 'homekit'), join(directory, 'homekit'), {
            recursive: true,
          });
        const kitsune: string[] = [];
        for (const name of ['state', 'hooks']) {
          const kitsuneSource = join(this.config.data, 'kitsune', name);
          if ((await stat(kitsuneSource).catch(() => null))?.isDirectory()) {
            await cp(kitsuneSource, join(directory, 'kitsune', name), { recursive: true });
            kitsune.push('kitsune/' + name);
          }
        }
        await runCommand(
          'tar',
          [
            '-czf',
            archive,
            '-C',
            directory,
            'haus.sqlite',
            'options.json',
            'backup.key',
            ...(homekit?.isDirectory() ? ['homekit'] : []),
            ...kitsune,
          ],
          { timeout: 120000, maxBuffer: 1024 * 1024 },
        );
        source = createReadStream(archive);
      } else {
        if (this.config.standalone) throw new Error('supervisor_backups_unavailable');
        haSlug = await supervisorBackup(
          this.supervisor.bind(this),
          {
            name: `Haus ${new Date(createdAt).toISOString()} ${randomUUID()}`,
            compressed: true,
            homeassistant: true,
            addons: 'ALL',
            folders: ['ssl', 'share', 'addons/local'],
          },
          { signal: this.abort.signal },
        );
        const download = await this.supervisor(`/backups/${haSlug}/download`);
        if (!download.body) throw new Error('supervisor_backup_failed');
        source = Readable.from(download.body);
      }
      const free = await statfs(this.root);
      const budget = Math.min(
        20 * 1024 ** 3,
        free.bavail * free.bsize - 512 * 1024 ** 2,
      );
      if (budget < 1) throw new Error('backup_storage_full');
      const temporary = join(directory, 'sealed.enc');
      const result = await seal(
        source,
        temporary,
        this.key,
        { kind, createdAt },
        { maxBytes: budget },
      );
      await rename(temporary, this.path(result.digest));
      await this.catalog.saveBackup({
        digest: result.digest,
        kind,
        createdAt,
        bytes: result.size,
        haSlug: haSlug ?? null,
        archiveGeneration,
      });
      await this.catalog.clearRetry(kind);
      this.errors.delete(kind);
      if (kind === 'haus' && this.dirtyAt === dirtyAt) this.dirtyAt = undefined;
      await this.prune(kind);
      return this.list().find((item) => item.digest === result.digest);
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { status?: number };
      if (!this.abort.signal.aborted) {
        await this.catalog.recordFailure(kind);
      }
      const storage =
        ['backup_storage_full', 'backup_too_large'].includes(err.message) ||
        err.code === 'ENOSPC';
      const message = storage
        ? 'Not enough free storage to keep this backup. Free space before retrying.'
        : kind === 'ha'
          ? 'Home Assistant backup could not complete. Automatic retries will wait before trying again.'
          : 'Configuration backup could not complete. Automatic retries will wait before trying again.';
      this.errors.delete(kind);
      this.errors.set(kind, message);
      console.warn(
        `Haus ${kind} backup failed (${storage ? 'storage' : err.status ? `Supervisor HTTP ${err.status}` : 'backup operation'})`,
      );
      throw error;
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  async supervisor(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const response = await fetch(`http://supervisor${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.any([
        AbortSignal.timeout(1800000),
        this.abort.signal,
        ...(init.signal ? [init.signal] : []),
      ]),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      const error = Object.assign(new Error('supervisor_backup_failed'), {
        status: response.status,
      });
      throw error;
    }
    return response;
  }

  async prune(kind?: string): Promise<void[]> {
    return Promise.all(
      (kind ? [kind] : ['haus', 'ha']).map((current) => {
        const task = (this.pruning.get(current) ?? Promise.resolve()).then(() =>
          this.pruneSnapshots(current),
        );
        this.pruning.set(
          current,
          task.catch(() => {}),
        );
        return task;
      }),
    );
  }

  async pruneSnapshots(kind: string): Promise<void> {
    let count = 0;
    for (const item of this.list().filter((item) => item.kind === kind)) {
      const limit = kind === 'ha' ? 7 : 24;
      if (++count <= limit) continue;
      await unlink(this.path(item.digest)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await this.catalog.removeBackup(item.digest);
      if (item.haSlug && !this.config.standalone)
        await this.supervisor(`/backups/${item.haSlug}`, { method: 'DELETE' })
          .then((response) => response.body?.cancel())
          .catch(() => {});
    }
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await Promise.allSettled(this.running.values());
    await Promise.allSettled(this.pruning.values());
  }

  markChanged(): void {
    this.dirtyAt = Date.now();
  }

  async tick(): Promise<void> {
    if (this.abort.signal.aborted) return;
    const list = this.list();
    const now = Date.now();
    const last = (kind: string) =>
      list.find((item) => item.kind === kind)?.createdAt ?? 0;
    const ready = (kind: string) =>
      now >= (this.catalog.retry(kind)?.nextAt ?? 0);
    if (
      this.canSnapshot('haus') &&
      ready('haus') &&
      (now - last('haus') > 3600000 ||
        (this.dirtyAt && now - this.dirtyAt >= 10000))
    )
      await this.snapshot('haus');
    else if (
      this.canSnapshot('ha') &&
      !this.config.standalone &&
      this.config.ha_backups_enabled &&
      ready('ha') &&
      now - last('ha') > 86400000
    )
      await this.snapshot('ha');
  }
}
