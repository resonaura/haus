import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitizeCameraDiagnostic } from '../shared/camera-diagnostics';

/** Bounded local logs contain controller metadata only, never media or network addresses. */
export class CameraDiagnostics {
  private tail = Promise.resolve();
  private queued = 0;
  constructor(
    private directory: string,
    private maxBytes = 1024 * 1024,
  ) {}
  write(value: unknown) {
    const entry = sanitizeCameraDiagnostic(value);
    if (!entry || this.queued >= 256) return;
    ++this.queued;
    this.tail = this.tail
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const path = join(this.directory, 'camera.log');
        const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
        const size = await stat(path)
          .then((file) => file.size)
          .catch(() => 0);
        if (size + Buffer.byteLength(line) > this.maxBytes)
          await rename(path, join(this.directory, 'camera.previous.log')).catch(() => {});
        await appendFile(path, line, { mode: 0o600 });
      })
      .catch(() => {})
      .finally(() => {
        --this.queued;
      });
  }
  flush() {
    return this.tail;
  }
}
