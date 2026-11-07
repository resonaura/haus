/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { nodeRoles } from '../nvr/roles.js';
import { storageLimitFromEnvironment } from '../nvr/settings.js';

export interface RuntimeConfig {
  root: string;
  port: number;
  address: string;
  env: NodeJS.ProcessEnv;
  nvr?: NvrConfig;
}
export interface NvrConfig {
  root: string;
  key: string;
  roles: string[];
  nodeId?: string;
  origin?: string;
  storageLimit: number | null;
  maxStreams?: number;
  collectorFile?: string;
}

export async function runtimeConfig(env: NodeJS.ProcessEnv = process.env): Promise<RuntimeConfig> {
  if (env.HAUS_DATA && env.HAUS_DATA_DIR && resolve(env.HAUS_DATA) !== resolve(env.HAUS_DATA_DIR))
    throw Error('conflicting_data_directories');
  const root = resolve(env.HAUS_DATA_DIR || env.HAUS_DATA || '/data');
  const enabled = Boolean(
    env.HAUS_NODE_KEY_FILE || env.HAUS_NODE_KEY || env.HAUS_ROLES !== undefined,
  );
  const port = Number(env.PORT ?? (enabled ? 8098 : 8790));
  const address = env.HAUS_BIND_ADDRESS || '0.0.0.0';
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535 || !isIP(address))
    throw Error('invalid_listener_configuration');
  const result: RuntimeConfig = { root, port, address, env: { ...env } };
  if (!enabled) return result;
  const key = (
    env.HAUS_NODE_KEY_FILE
      ? await readFile(env.HAUS_NODE_KEY_FILE, 'utf8')
      : env.HAUS_NODE_KEY || ''
  ).trim();
  if (Buffer.byteLength(key) < 32) throw Error('invalid_nvr_key');
  let origin: string | undefined;
  if (env.HAUS_SOURCE_ORIGIN) {
    const url = new URL(env.HAUS_SOURCE_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw Error('invalid_source_origin');
    origin = url.origin;
  }
  const maxStreams = env.HAUS_MAX_STREAMS === undefined ? undefined : Number(env.HAUS_MAX_STREAMS);
  if (
    maxStreams !== undefined &&
    (!Number.isInteger(maxStreams) || maxStreams < 1 || maxStreams > 32)
  )
    throw Error('invalid_stream_budget');
  result.nvr = {
    root,
    key,
    roles: nodeRoles(env.HAUS_ROLES),
    nodeId: env.HAUS_NODE_ID,
    origin,
    storageLimit: storageLimitFromEnvironment(env.HAUS_MAX_STORAGE_GB),
    maxStreams,
    collectorFile: env.HAUS_HOST_TELEMETRY_FILE || undefined,
  };
  return result;
}
