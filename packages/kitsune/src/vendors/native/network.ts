/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { isIP } from 'node:net';
export const privateIp = (value: string) =>
  isIP(value) === 4
    ? /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)/.test(value)
    : isIP(value) === 6 && (/^(?:fc|fd)[a-f0-9:]+$/i.test(value) || value === '::1');
export function eufyAddress(input: string) {
  const url = new URL(input),
    host = url.hostname;
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !(privateIp(host) || host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan'))
  )
    throw Error('Invalid Eufy WebSocket address');
  return url.href;
}
