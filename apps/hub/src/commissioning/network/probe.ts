/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createConnection } from 'node:net';

export type NetworkReachabilityProbe = (
  host: string,
  port: number,
  timeoutMs?: number,
) => Promise<boolean>;

/** Non-blocking TCP reachability probe for LAN management endpoints (router, switch, NAS, etc.). */
export function probeTcpReachability(
  host: string,
  port: number,
  timeoutMs = 2_000,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };

    const socket = createConnection({ host, port });
    socket.setTimeout(Math.max(250, timeoutMs));
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
