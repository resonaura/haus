/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { RoomMoveRepository, RoomMovePersistenceState } from './types.js';

export class InMemoryRoomMoveRepository implements RoomMoveRepository {
  private readonly states = new Map<string, string>();
  private failNextSaveError?: Error;

  injectNextSaveFailure(error: Error): void {
    this.failNextSaveError = error;
  }

  async load(homeId: string): Promise<RoomMovePersistenceState | undefined> {
    const raw = this.states.get(homeId);
    return raw ? (JSON.parse(raw) as RoomMovePersistenceState) : undefined;
  }

  async save(state: RoomMovePersistenceState): Promise<void> {
    if (this.failNextSaveError) {
      const err = this.failNextSaveError;
      this.failNextSaveError = undefined;
      throw err;
    }
    this.states.set(state.homeId, JSON.stringify(state));
  }
}
