/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { HaSyncCredentialInput } from '@haus/kitsune';
import { StandaloneHomePersistence } from '../../home/home.persistence.js';
import type { Transactions } from '../../storage/transactions.js';
import { resolveOrProvisionMasterKey } from '../../cluster/crypto/master-key.js';
import { AesGcmCredentialCipher } from '../credentials.service.js';

const APP_CRED_KIND = 'ha_app_credential';
const ENTRY_RUNTIME_KIND = 'ha_entry_runtime';
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

export interface StoredAppCredentialPublic {
  readonly domain: string;
  readonly clientId: string;
  readonly hasSecret: boolean;
  readonly name?: string;
  readonly authDomain?: string;
  readonly createdAt: string;
}

interface PersistedAppCredential {
  readonly domain: string;
  readonly clientId: string;
  readonly encryptedSecret?: string;
  readonly name?: string;
  readonly authDomain?: string;
  readonly createdAt: string;
}

interface PersistedEntryPayload {
  readonly entryId: string;
  readonly encryptedJson: string;
  readonly updatedAt: string;
}

export function resolveHaDataDir(): string {
  if (process.env.HAUS_HA_FLOW_DIR?.trim()) {
    return resolve(process.env.HAUS_HA_FLOW_DIR.trim());
  }
  const dataDir = process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA;
  if (dataDir?.trim()) {
    return join(resolve(dataDir.trim()), 'ha-flow');
  }
  if (process.env.VITEST) {
    return join(tmpdir(), `haus-ha-flow-${process.pid}`);
  }
  if (existsSync('/data')) {
    return '/data/ha-flow';
  }
  return resolve('.local/cache/ha-flow');
}

export function resolveFrontendBase(): string {
  const configured =
    process.env.HAUS_FRONTEND_BASE ?? process.env.HAUS_PUBLIC_URL ?? process.env.HAUS_HUB_URL;
  if (configured?.trim()) {
    return configured.trim().replace(/\/+$/, '');
  }
  const port = process.env.PORT?.trim() || '8790';
  return `http://127.0.0.1:${port}`;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function parseMultipartFileFromRequest(
  req: IncomingMessage,
  contentType: string,
): Promise<{ readonly filename: string; readonly content: Buffer } | undefined> {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return undefined;

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > MAX_UPLOAD_BYTES) {
      throw new Error('file_too_large');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks);
  const delim = Buffer.from(`--${boundary}`);
  let pos = raw.indexOf(delim);
  while (pos >= 0) {
    const partStart = pos + delim.length;
    if (raw.subarray(partStart, partStart + 2).equals(Buffer.from('--'))) break;
    const headerStart = raw.subarray(partStart, partStart + 2).equals(Buffer.from('\r\n'))
      ? partStart + 2
      : partStart;
    const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd < 0) break;
    const headers = raw.subarray(headerStart, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextDelim = raw.indexOf(delim, bodyStart);
    if (nextDelim < 0) break;
    const bodyEnd =
      nextDelim >= 2 && raw.subarray(nextDelim - 2, nextDelim).equals(Buffer.from('\r\n'))
        ? nextDelim - 2
        : nextDelim;
    const filenameMatch = /filename="([^"]+)"/i.exec(headers);
    if (filenameMatch?.[1]) {
      const safeName = filenameMatch[1].split(/[/\\]/).pop() || 'upload.bin';
      return { filename: safeName, content: raw.subarray(bodyStart, bodyEnd) };
    }
    pos = nextDelim;
  }
  return undefined;
}

export class EncryptedHaSecretsStore {
  private readonly persistence: StandaloneHomePersistence;
  private readonly cipher: AesGcmCredentialCipher;
  private readonly credentials = new Map<string, PersistedAppCredential>();
  private readonly entryPayloads = new Map<
    string,
    { readonly data: Record<string, unknown>; readonly options: Record<string, unknown> }
  >();
  private loaded = false;

  constructor(transactions?: Transactions, dataDir?: string) {
    this.persistence = new StandaloneHomePersistence(transactions);
    this.cipher = new AesGcmCredentialCipher(resolveOrProvisionMasterKey({ dataDir }));
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const creds = await this.persistence.listByKind<PersistedAppCredential>(APP_CRED_KIND);
      for (const row of creds) {
        if (row.value?.domain && row.value?.clientId) {
          this.credentials.set(row.value.domain, row.value);
        }
      }
      const entries = await this.persistence.listByKind<PersistedEntryPayload>(ENTRY_RUNTIME_KIND);
      for (const row of entries) {
        if (!row.value?.entryId || !row.value?.encryptedJson) continue;
        try {
          const decrypted = await this.cipher.decrypt(row.value.encryptedJson);
          const parsed = JSON.parse(Buffer.from(decrypted).toString('utf8')) as {
            data?: Record<string, unknown>;
            options?: Record<string, unknown>;
          };
          this.entryPayloads.set(row.value.entryId, {
            data: parsed.data ?? {},
            options: parsed.options ?? {},
          });
        } catch {
          // Ignore unreadable payload sealed with a different key.
        }
      }
    } catch {
      // Optional in standalone unit tests without database backing.
    }
  }

  async saveCredential(input: HaSyncCredentialInput): Promise<StoredAppCredentialPublic> {
    await this.ensureLoaded();
    let encryptedSecret: string | undefined;
    if (input.clientSecret) {
      encryptedSecret = await this.cipher.encrypt(Buffer.from(input.clientSecret, 'utf8'));
    }
    const record: PersistedAppCredential = {
      domain: input.domain,
      clientId: input.clientId,
      encryptedSecret,
      name: input.name,
      authDomain: input.authDomain,
      createdAt: this.credentials.get(input.domain)?.createdAt ?? new Date().toISOString(),
    };
    this.credentials.set(input.domain, record);
    await this.persistence.save(APP_CRED_KIND, input.domain, record);
    return {
      domain: record.domain,
      clientId: record.clientId,
      hasSecret: Boolean(record.encryptedSecret),
      name: record.name,
      authDomain: record.authDomain,
      createdAt: record.createdAt,
    };
  }

  async deleteCredential(domain: string): Promise<boolean> {
    await this.ensureLoaded();
    const existed = this.credentials.delete(domain);
    await this.persistence.remove(APP_CRED_KIND, domain);
    return existed;
  }

  async listCredentialsPublic(): Promise<readonly StoredAppCredentialPublic[]> {
    await this.ensureLoaded();
    return Array.from(this.credentials.values()).map((c) => ({
      domain: c.domain,
      clientId: c.clientId,
      hasSecret: Boolean(c.encryptedSecret),
      name: c.name,
      authDomain: c.authDomain,
      createdAt: c.createdAt,
    }));
  }

  async getCredentialsForHaSync(): Promise<readonly HaSyncCredentialInput[]> {
    await this.ensureLoaded();
    const out: HaSyncCredentialInput[] = [];
    for (const c of this.credentials.values()) {
      let clientSecret = '';
      if (c.encryptedSecret) {
        try {
          clientSecret = Buffer.from(await this.cipher.decrypt(c.encryptedSecret)).toString('utf8');
        } catch {
          clientSecret = '';
        }
      }
      out.push({
        domain: c.domain,
        clientId: c.clientId,
        clientSecret,
        name: c.name,
        authDomain: c.authDomain,
      });
    }
    return out;
  }

  async saveEntryPayload(
    entryId: string,
    data: Readonly<Record<string, unknown>> | undefined,
    options: Readonly<Record<string, unknown>> | undefined,
  ): Promise<void> {
    await this.ensureLoaded();
    const normalized = {
      data: data ? { ...data } : {},
      options: options ? { ...options } : {},
    };
    this.entryPayloads.set(entryId, normalized);
    const encryptedJson = await this.cipher.encrypt(
      Buffer.from(JSON.stringify(normalized), 'utf8'),
    );
    const payload: PersistedEntryPayload = {
      entryId,
      encryptedJson,
      updatedAt: new Date().toISOString(),
    };
    await this.persistence.save(ENTRY_RUNTIME_KIND, entryId, payload);
  }

  async getEntryPayload(
    entryId: string,
  ): Promise<
    | { readonly data: Record<string, unknown>; readonly options: Record<string, unknown> }
    | undefined
  > {
    await this.ensureLoaded();
    return this.entryPayloads.get(entryId);
  }

  async deleteEntryPayload(entryId: string): Promise<void> {
    await this.ensureLoaded();
    this.entryPayloads.delete(entryId);
    await this.persistence.remove(ENTRY_RUNTIME_KIND, entryId);
  }

  close(): void {
    this.persistence.close();
  }
}
