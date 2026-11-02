import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitizeHelperDiagnostic } from '../shared/helper-diagnostics';

/** Bounded local failure journal with operation classes only; it never stores addresses or secrets. */
export class HelperDiagnostics {
  private tail = Promise.resolve();
  private queued = 0;
  constructor(
    private directory: string,
    private maxBytes = 64 * 1024,
  ) {}
  write(value: unknown) {
    const entry = sanitizeHelperDiagnostic(value);
    if (!entry || this.queued >= 32) return;
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
    if (Buffer.byteLength(line) > this.maxBytes) return;
    ++this.queued;
    this.tail = this.tail
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const file = join(this.directory, 'helper.log');
        const size = await stat(file)
          .then((current) => current.size)
          .catch(() => 0);
        if (size + Buffer.byteLength(line) > this.maxBytes)
          await rename(file, join(this.directory, 'helper.previous.log')).catch(() => {});
        await appendFile(file, line, { mode: 0o600 });
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
