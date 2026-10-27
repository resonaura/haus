import { CameraSnapshotCache } from './camera-snapshot-cache';
import { safeStorage } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRecord, normalizeServerUrl, validatePreferences } from './validation';

export interface StoredSession {
  url: string;
  name: string;
  clientId: string;
  refreshToken: string;
}

export class SecureStore {
  private sessionWrite: Promise<void> = Promise.resolve();
  private preferenceWrite: Promise<void> = Promise.resolve();
  private cameraAccessWrite: Promise<void> = Promise.resolve();
  readonly cameraSnapshots: CameraSnapshotCache;
  constructor(private readonly directory: string) {
    this.cameraSnapshots = new CameraSnapshotCache(join(directory, 'camera-cache'));
  }

  assertAvailable(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    ) {
      throw new Error(
        'Secure system storage is unavailable. Unlock your system keychain and try again.',
      );
    }
  }

  async loadSession(): Promise<StoredSession | null> {
    const buffer = await this.readOptional('session.enc');
    if (!buffer) return null;
    this.assertAvailable();
    try {
      const value: unknown = JSON.parse(safeStorage.decryptString(buffer));
      if (
        !isRecord(value) ||
        typeof value.url !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.clientId !== 'string' ||
        typeof value.refreshToken !== 'string' ||
        !value.refreshToken
      )
        throw new Error('Invalid encrypted session.');
      return {
        url: normalizeServerUrl(value.url),
        name: value.name,
        clientId: value.clientId,
        refreshToken: value.refreshToken,
      };
    } catch {
      throw new Error('The saved session could not be unlocked. Disconnect and sign in again.');
    }
  }

  async saveSession(value: StoredSession): Promise<void> {
    this.assertAvailable();
    const encrypted = safeStorage.encryptString(JSON.stringify(value));
    const write = this.sessionWrite
      .catch(() => undefined)
      .then(() => this.writeAtomic('session.enc', encrypted));
    this.sessionWrite = write;
    await write;
  }

  async clearSession(): Promise<void> {
    const write = this.sessionWrite
      .catch(() => undefined)
      .then(() => rm(join(this.directory, 'session.enc'), { force: true }));
    this.sessionWrite = write;
    await write;
    await this.cameraAccessWrite.catch(() => {});
    await rm(join(this.directory, 'camera-access.enc'), { force: true });
  }

  async loadCameraAccess(): Promise<unknown> {
    const bytes = await this.readOptional('camera-access.enc');
    if (!bytes) return null;
    this.assertAvailable();
    if (bytes.length > 2_000_000) throw Error('Invalid camera access cache.');
    return JSON.parse(safeStorage.decryptString(bytes));
  }
  async saveCameraAccess(
    scope: string,
    clientId: string,
    cameraId: string,
    routes: unknown,
  ): Promise<void> {
    this.assertAvailable();
    const task = this.cameraAccessWrite
      .catch(() => {})
      .then(async () => {
        const previous = await this.loadCameraAccess().catch(() => null);
        const cameras =
          isRecord(previous) && previous.scope === scope && isRecord(previous.cameras)
            ? { ...previous.cameras }
            : {};
        cameras[cameraId] = routes;
        if (Object.keys(cameras).length > 64) delete cameras[Object.keys(cameras)[0]];
        const text = JSON.stringify({ scope, clientId, cameras });
        if (text.length > 1_000_000) throw Error('Camera access cache is too large.');
        await this.writeAtomic('camera-access.enc', safeStorage.encryptString(text));
      });
    this.cameraAccessWrite = task;
    await task;
  }

  async getPreferences(): Promise<Record<string, unknown>> {
    const buffer = await this.readOptional('preferences.json');
    if (!buffer) return {};
    try {
      return validatePreferences(JSON.parse(buffer.toString('utf8')));
    } catch {
      return {};
    }
  }

  async setPreferences(patch: Record<string, unknown>): Promise<void> {
    const safePatch = validatePreferences(patch);
    const write = this.preferenceWrite
      .catch(() => undefined)
      .then(async () => {
        const current = await this.getPreferences();
        await this.writeAtomic(
          'preferences.json',
          JSON.stringify(validatePreferences({ ...current, ...safePatch }), null, 2),
        );
      });
    this.preferenceWrite = write;
    await write;
  }

  private async readOptional(name: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async writeAtomic(name: string, contents: Buffer | string): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `.${name}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
      await rename(temporary, join(this.directory, name));
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
