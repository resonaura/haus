/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface ParsedSerialAddress {
  readonly type: 'serial' | 'tcp';
  readonly raw: string;
  readonly path?: string;
  readonly host?: string;
  readonly port?: number;
}

export class SerialExclusivityError extends Error {
  public readonly code = 'SERIAL_PORT_BUSY';
  public readonly portPath: string;
  public readonly existingOwner?: string;
  public readonly guidance: string;

  public constructor(portPath: string, existingOwner?: string) {
    const ownerText = existingOwner ? ` by owner '${existingOwner}'` : '';
    const guidance =
      `Serial port '${portPath}' is currently locked${ownerText}. ` +
      `Ensure no competing coordinator (Zigbee2MQTT, ZHA, Thread) or stale process holds the port. ` +
      `Verify physical dongle connection or use a network coordinator (tcp://host:port).`;
    super(`SERIAL_PORT_BUSY: ${guidance}`);
    this.name = 'SerialExclusivityError';
    this.portPath = portPath;
    this.existingOwner = existingOwner;
    this.guidance = guidance;
  }
}

export function isNetworkSerialAddress(address: string): boolean {
  return /^tcp:\/\/[^:]+:\d+$/.test(address.trim());
}

export function parseSerialAddress(address: string): ParsedSerialAddress {
  const trimmed = address.trim();
  if (isNetworkSerialAddress(trimmed)) {
    const url = new URL(trimmed);
    return {
      type: 'tcp',
      raw: trimmed,
      host: url.hostname,
      port: Number(url.port),
    };
  }
  return {
    type: 'serial',
    raw: trimmed,
    path: trimmed,
  };
}

export class SerialPortGuard {
  private static readonly locks = new Map<string, { owner: string; acquiredAt: number }>();

  public static acquire(portPath: string, owner: string): void {
    const normalized = portPath.trim();
    const existing = this.locks.get(normalized);
    if (existing && existing.owner !== owner) {
      throw new SerialExclusivityError(normalized, existing.owner);
    }
    this.locks.set(normalized, { owner, acquiredAt: Date.now() });
  }

  public static release(portPath: string, owner: string): boolean {
    const normalized = portPath.trim();
    const existing = this.locks.get(normalized);
    if (existing && existing.owner === owner) {
      this.locks.delete(normalized);
      return true;
    }
    return false;
  }

  public static isLocked(portPath: string): boolean {
    return this.locks.has(portPath.trim());
  }

  public static getLockOwner(portPath: string): string | undefined {
    return this.locks.get(portPath.trim())?.owner;
  }

  public static clearAll(): void {
    this.locks.clear();
  }
}
