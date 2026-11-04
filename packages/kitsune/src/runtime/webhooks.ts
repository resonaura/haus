/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { FileStorage } from '../sdk/storage.js';
export function webhookToken(dataDirectory: string, pluginId: string) {
  const storage = new FileStorage(join(dataDirectory, 'kitsune', 'hooks'));
  const state = storage.get(pluginId);
  if (state.token) return state.token;
  const token = randomBytes(32).toString('hex');
  storage.set(pluginId, 'token', token);
  return token;
}
export function authorizedWebhook(dataDirectory: string, pluginId: string, input: string) {
  if (!/^[a-f0-9]{64}$/.test(input)) return false;
  const expected = new FileStorage(join(dataDirectory, 'kitsune', 'hooks')).get(pluginId).token;
  return (
    typeof expected === 'string' &&
    expected.length === input.length &&
    timingSafeEqual(Buffer.from(input), Buffer.from(expected))
  );
}
export function protectedEndpoint(base: string, token: string) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${token}`;
  return url.href;
}
