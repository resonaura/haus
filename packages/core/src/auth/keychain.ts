/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface HardwareKeychainPort {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<boolean>;
  hasSecret(key: string): Promise<boolean>;
  listKeys(): Promise<string[]>;
}

export class InMemoryHardwareKeychain implements HardwareKeychainPort {
  private readonly store = new Map<string, string>();

  public async getSecret(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  public async setSecret(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  public async deleteSecret(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  public async hasSecret(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  public async listKeys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  public clear(): void {
    this.store.clear();
  }
}
