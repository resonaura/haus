import { safeStorage } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ServerSshInput, ServerSshProfile } from '../shared/terminal';

type SavedProfile = ServerSshInput & { fingerprints?: string[] };
export class ServerSshStore {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) {}
  async load(): Promise<Record<string, SavedProfile>> {
    try {
      const bytes = await readFile(join(this.directory, 'server-ssh.enc'));
      this.available();
      const value = JSON.parse(safeStorage.decryptString(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Invalid SSH profiles.');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw Error('SSH connection settings could not be unlocked.');
    }
  }
  available() {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw Error('Unlock the system keychain to save SSH connections.');
  }
  async profile(id: string): Promise<ServerSshProfile | null> {
    const saved = (await this.load())[id];
    return saved
      ? {
          serverId: saved.serverId,
          host: saved.host,
          port: saved.port,
          username: saved.username,
          environment: saved.environment,
          auth: saved.auth,
          hasPassword: Boolean(saved.password),
        }
      : null;
  }
  async profiles(): Promise<ServerSshProfile[]> {
    const all = await this.load();
    return Object.values(all).flatMap((saved) =>
      typeof saved.serverId === 'string' &&
      typeof saved.host === 'string' &&
      typeof saved.username === 'string' &&
      Number.isInteger(saved.port) &&
      (saved.auth === 'agent' || saved.auth === 'password') &&
      (saved.environment === 'native' || saved.environment === 'wsl')
        ? [
            {
              serverId: saved.serverId,
              host: saved.host,
              port: saved.port,
              username: saved.username,
              environment: saved.environment,
              auth: saved.auth,
              hasPassword: Boolean(saved.password),
            },
          ]
        : [],
    );
  }
  async save(input: ServerSshInput, fingerprints: string[]) {
    this.available();
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        const all = await this.load();
        all[input.serverId] = {
          ...input,
          password: input.rememberPassword ? input.password : undefined,
          fingerprints,
          rememberPassword: undefined,
        };
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = join(this.directory, `.server-ssh-${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, safeStorage.encryptString(JSON.stringify(all)), {
            flag: 'wx',
            mode: 0o600,
          });
          await rename(temporary, join(this.directory, 'server-ssh.enc'));
        } finally {
          await rm(temporary, { force: true });
        }
      });
    this.writes = operation;
    return operation;
  }
  async remove(id: string) {
    this.available();
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        const all = await this.load();
        delete all[id];
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = join(this.directory, `.server-ssh-${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, safeStorage.encryptString(JSON.stringify(all)), {
            flag: 'wx',
            mode: 0o600,
          });
          await rename(temporary, join(this.directory, 'server-ssh.enc'));
        } finally {
          await rm(temporary, { force: true });
        }
      });
    this.writes = operation;
    return operation;
  }
}
