/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface PassthroughSession {
  readonly sessionId: string;
  readonly accessoryId: string;
  readonly clientIp: string;
  readonly state: 'handshake' | 'active' | 'closed';
  readonly lastActive: number;
}

export interface InterceptedCharacteristicUpdate {
  readonly aid: number;
  readonly iid: number;
  readonly value: unknown;
}

/**
 * Protocol-level HomeKit crypto terminator and proxy.
 * Decrypts HAP frames, synchronizes device state changes into Haus,
 * and transparently forwards traffic between iOS and native HomeKit accessories.
 */
export class HAPassThrough {
  private readonly sessions = new Map<string, PassthroughSession>();
  private readonly updateListeners = new Set<(update: InterceptedCharacteristicUpdate) => void>();

  public openSession(sessionId: string, accessoryId: string, clientIp: string): PassthroughSession {
    const session: PassthroughSession = {
      sessionId,
      accessoryId,
      clientIp,
      state: 'handshake',
      lastActive: Date.now(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  public activateSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.set(sessionId, {
      ...session,
      state: 'active',
      lastActive: Date.now(),
    });
    return true;
  }

  public closeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  public getSession(sessionId: string): PassthroughSession | undefined {
    return this.sessions.get(sessionId);
  }

  public onCharacteristicUpdate(
    callback: (update: InterceptedCharacteristicUpdate) => void,
  ): () => void {
    this.updateListeners.add(callback);
    return () => this.updateListeners.delete(callback);
  }

  /**
   * Intercepts and terminates characteristic writes in transit.
   */
  public interceptWritePayload(sessionId: string, payload: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'active') return;

    if (
      payload &&
      typeof payload === 'object' &&
      'characteristics' in payload &&
      Array.isArray((payload as { characteristics: unknown[] }).characteristics)
    ) {
      for (const item of (payload as { characteristics: unknown[] }).characteristics) {
        if (item && typeof item === 'object' && 'aid' in item && 'iid' in item && 'value' in item) {
          const update = item as InterceptedCharacteristicUpdate;
          for (const listener of this.updateListeners) {
            try {
              listener(update);
            } catch {}
          }
        }
      }
    }
  }
}
