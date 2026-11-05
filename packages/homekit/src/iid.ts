/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface IidStore {
  getIid(accessoryId: string, itemKey: string): Promise<number | null>;
  setIid(accessoryId: string, itemKey: string, iid: number): Promise<void>;
  getNextIid(accessoryId: string): Promise<number>;
  clear(accessoryId?: string): Promise<void>;
}

export class InMemoryIidStore implements IidStore {
  private readonly store = new Map<string, Map<string, number>>();
  private readonly nextIids = new Map<string, number>();

  public async getIid(accessoryId: string, itemKey: string): Promise<number | null> {
    return this.store.get(accessoryId)?.get(itemKey) ?? null;
  }

  public async setIid(accessoryId: string, itemKey: string, iid: number): Promise<void> {
    let accMap = this.store.get(accessoryId);
    if (!accMap) {
      accMap = new Map();
      this.store.set(accessoryId, accMap);
    }
    accMap.set(itemKey, iid);

    const currentNext = this.nextIids.get(accessoryId) ?? 1;
    if (iid >= currentNext) {
      this.nextIids.set(accessoryId, iid + 1);
    }
  }

  public async getNextIid(accessoryId: string): Promise<number> {
    const current = this.nextIids.get(accessoryId) ?? 1;
    this.nextIids.set(accessoryId, current + 1);
    return current;
  }

  public async clear(accessoryId?: string): Promise<void> {
    if (accessoryId) {
      this.store.delete(accessoryId);
      this.nextIids.delete(accessoryId);
    } else {
      this.store.clear();
      this.nextIids.clear();
    }
  }
}

/**
 * Deterministically assigns and preserves Instance IDs (iid) for HomeKit accessories,
 * services, and characteristics to eliminate Apple Home cache invalidation ("No Response").
 */
export class DeterministicIidManager {
  constructor(private readonly store: IidStore = new InMemoryIidStore()) {}

  public async allocateIid(accessoryId: string, itemKey: string): Promise<number> {
    const existing = await this.store.getIid(accessoryId, itemKey);
    if (existing !== null) {
      return existing;
    }

    const next = await this.store.getNextIid(accessoryId);
    await this.store.setIid(accessoryId, itemKey, next);
    return next;
  }

  public async getExistingIid(accessoryId: string, itemKey: string): Promise<number | null> {
    return this.store.getIid(accessoryId, itemKey);
  }
}
