/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { constants } from 'node:fs';
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDmiInstalledMemory } from '../memory.js';

interface ProbeIo {
  list(path: string): Promise<string[]>;
  read(path: string, limit: number): Promise<Buffer>;
  now(): Date;
}

export async function readProbeFile(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw Error('hardware_probe_input_limit');
    return buffer.subarray(0, size);
  } finally {
    await file.close();
  }
}

/** Optional privileged inventory; only capacity, boot identity and time leave this boundary. */
export class MemoryProbe {
  constructor(
    private readonly io: ProbeIo = {
      list: readdir,
      read: readProbeFile,
      now: () => new Date(),
    },
  ) {}

  async write(output: string): Promise<void> {
    if (!isAbsolute(output)) throw Error('hardware_probe_absolute_output_required');
    const names = await this.io.list('/sys/firmware/dmi/entries').then(
      (entries) => entries.filter((name) => /^17-[\da-f]+$/i.test(name)),
      () => [], // Missing/restricted firmware is unknown, never estimated.
    );
    if (!names.length || names.length > 128) throw Error('installed_memory_not_reported');
    const raw = await Promise.all(
      names.map((name) =>
        this.io.read(`/sys/firmware/dmi/entries/${name}/raw`, 4096).then(
          (bytes) => bytes,
          () => null,
        ),
      ),
    );
    const installedBytes = raw.every(Buffer.isBuffer) ? parseDmiInstalledMemory(raw) : null;
    if (installedBytes === null) throw Error('installed_memory_not_reported');
    const bootId = (await this.io.read('/proc/sys/kernel/random/boot_id', 64)).toString().trim();
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(bootId))
      throw Error('invalid_boot_identity');
    const report = { version: 1, installedBytes, bootId, sampledAt: this.io.now().toISOString() };
    await mkdir(dirname(output), { recursive: true, mode: 0o755 });
    const temporary = output + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, 'wx', 0o644);
    try {
      try {
        await file.writeFile(JSON.stringify(report) + '\n');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, output);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
