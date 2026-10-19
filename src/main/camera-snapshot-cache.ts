import { safeStorage } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export interface CachedCameraSnapshot {
  image: string;
  receivedAt: number;
}
/** Private, home-scoped last frames. Memory and encrypted disk each have a fixed budget. */
export class CameraSnapshotCache {
  private memory = new Map<string, CachedCameraSnapshot>();
  private persisted = new Map<string, number>();
  private writes = Promise.resolve();
  constructor(private directory: string) {}
  private key(home: string, id: string) {
    return createHash('sha256')
      .update(home + '\0' + id)
      .digest('hex');
  }
  async get(home: string, id: string): Promise<CachedCameraSnapshot | null> {
    const key = this.key(home, id);
    const known = this.memory.get(key);
    if (known) return known;
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      return null;
    try {
      const bytes = await readFile(join(this.directory, key));
      if (bytes.length > 9 * 1024 ** 2) return null;
      const value = JSON.parse(safeStorage.decryptString(bytes)) as CachedCameraSnapshot;
      if (!this.valid(value)) return null;
      this.remember(key, value);
      return value;
    } catch {
      return null;
    }
  }
  put(home: string, id: string, value: CachedCameraSnapshot) {
    if (!this.valid(value)) return;
    const key = this.key(home, id);
    this.remember(key, value);
    if (
      Date.now() - (this.persisted.get(key) ?? 0) < 60000 ||
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      return;
    this.persisted.set(key, Date.now());
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const output = join(this.directory, key),
          temporary = output + '.partial';
        await writeFile(temporary, safeStorage.encryptString(JSON.stringify(value)), {
          mode: 0o600,
        });
        await rename(temporary, output);
        const files = await Promise.all(
          (await readdir(this.directory))
            .filter((name) => /^[a-f0-9]{64}$/.test(name))
            .map(async (name) => ({ name, info: await stat(join(this.directory, name)) })),
        );
        files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
        let bytes = 0;
        for (let i = 0; i < files.length; i++) {
          bytes += files[i].info.size;
          if (i >= 24 || bytes > 48 * 1024 ** 2) await unlink(join(this.directory, files[i].name));
        }
      })
      .catch(() => {});
  }
  private valid(value: CachedCameraSnapshot) {
    return (
      typeof value?.image === 'string' &&
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value.image) &&
      value.image.length <= 8 * 1024 ** 2 &&
      Number.isFinite(value.receivedAt)
    );
  }
  private remember(key: string, value: CachedCameraSnapshot) {
    this.memory.delete(key);
    this.memory.set(key, value);
    let bytes = 0,
      count = 0;
    for (const [id, frame] of [...this.memory].reverse()) {
      bytes += frame.image.length;
      if (++count > 24 || bytes > 32 * 1024 ** 2) {
        this.memory.delete(id);
        this.persisted.delete(id);
      }
    }
  }
}
