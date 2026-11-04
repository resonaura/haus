/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { PrivateFiles } from './files.js';

export interface HostIdentity {
  readonly homeId: string;
  readonly hubId: string;
}

function valid(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
}

export async function bindHost(files: PrivateFiles, identity: HostIdentity): Promise<void> {
  if (!valid(identity.homeId) || !valid(identity.hubId)) throw Error('invalid_host_identity');
  let bytes = await files.read('identity');
  if (!bytes) {
    if (await files.vaultExists()) throw Error('host_identity_missing');
    await files.publish('identity', Buffer.from(JSON.stringify({ version: 1, ...identity })));
    bytes = await files.read('identity');
  }
  if (!bytes) throw Error('host_identity_missing');
  let saved: unknown;
  try {
    saved = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw Error('host_identity_invalid');
  }
  if (
    !saved ||
    typeof saved !== 'object' ||
    Array.isArray(saved) ||
    !('version' in saved) ||
    saved.version !== 1 ||
    !('homeId' in saved) ||
    !valid(saved.homeId) ||
    !('hubId' in saved) ||
    !valid(saved.hubId) ||
    Object.keys(saved).sort().join(',') !== 'homeId,hubId,version'
  )
    throw Error('host_identity_invalid');
  if (saved.homeId !== identity.homeId || saved.hubId !== identity.hubId)
    throw Error('host_identity_mismatch');
}
