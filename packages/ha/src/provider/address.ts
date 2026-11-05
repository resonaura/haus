/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export interface HaProviderAddress {
  readonly base: URL;
  readonly websocket: URL;
}

/** Enrolled endpoints only; never send credentials to redirects or a different WebSocket origin. */
export function haProviderAddress(value: string, socket?: string): HaProviderAddress {
  try {
    const base = new URL(value);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw Error('invalid_ha_provider_address');
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const websocket = socket ? new URL(socket) : new URL('api/websocket', base);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    if (!socket) websocket.protocol = protocol;
    if (
      websocket.protocol !== protocol ||
      websocket.host !== base.host ||
      websocket.username ||
      websocket.password ||
      websocket.search ||
      websocket.hash
    )
      throw Error('invalid_ha_provider_address');
    return { base, websocket };
  } catch {
    throw Error('invalid_ha_provider_address');
  }
}
