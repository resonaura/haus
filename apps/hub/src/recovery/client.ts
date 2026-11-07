/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sign } from '../nvr/auth.js';
import { isRecord } from '../nvr/recovery.js';

export interface RecoveryNode {
  url: string;
  key: string;
  allowHttp?: boolean;
}
export interface RecoveryKit {
  key?: string;
  node: RecoveryNode;
}

export async function readRecoveryKit(path: string, id: string): Promise<RecoveryKit> {
  const handle = await open(resolve(path), 'r');
  let value: unknown;
  try {
    const budget = 2 * 1024 ** 2;
    const bytes = Buffer.alloc(budget + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > budget) throw Error('recovery_kit_too_large');
    value = JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally {
    await handle.close();
  }
  if (!isRecord(value) || !Array.isArray(value.nodes)) throw Error('invalid_recovery_kit');
  const nodes = value.nodes.filter((node) => isRecord(node) && node.id === id);
  if (nodes.length !== 1 || !isRecord(nodes[0])) throw Error('invalid_recovery_node');
  const node = nodes[0];
  if (
    typeof node.url !== 'string' ||
    typeof node.key !== 'string' ||
    Buffer.byteLength(node.key) < 32
  )
    throw Error('invalid_recovery_node');
  const base = new URL(node.url);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    (base.protocol === 'http:' && node.allowHttp !== true)
  )
    throw Error('untrusted_recovery_address');
  return {
    key: typeof value.key === 'string' ? value.key : undefined,
    node: { url: base.href, key: node.key, allowHttp: node.allowHttp === true },
  };
}

export class RecoveryClient {
  constructor(
    private readonly node: RecoveryNode,
    private readonly signal?: AbortSignal,
  ) {}
  async request(path: string): Promise<Response> {
    const response = await fetch(new URL(path, this.node.url), {
      headers: { ...sign(this.node.key, 'GET', path) },
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(600000), ...(this.signal ? [this.signal] : [])]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error('recovery_request_failed');
    }
    return response;
  }
  async json(path: string): Promise<unknown> {
    const response = await this.request(path);
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw Error('missing_recovery_body');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 ** 2) throw Error('recovery_metadata_too_large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }
}
