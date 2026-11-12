/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { CameraSnapshotFrame } from '../../shared/native';
import type { DesktopHubSessionManager } from '../hub-session';
import type { SecureStore } from '../secure-store';

const SNAPSHOT_LIMIT = 6 * 1024 * 1024;
type SnapshotCache = Pick<SecureStore['cameraSnapshots'], 'get' | 'put'>;

function isCameraId(value: unknown): value is string {
  return typeof value === 'string' && /^camera\.[a-z0-9_]+$/.test(value);
}

function validImage(buffer: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg')
    return (
      buffer.length >= 4 &&
      buffer[0] === 255 &&
      buffer[1] === 216 &&
      buffer.at(-2) === 255 &&
      buffer.at(-1) === 217
    );
  if (mime === 'image/png')
    return (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  return (
    mime === 'image/webp' &&
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

interface Dependencies {
  manager: Pick<DesktopHubSessionManager, 'bearer' | 'getSession' | 'reconnect'>;
  cache: SnapshotCache;
  fetchFn: typeof fetch;
  ensureSession: () => Promise<unknown>;
}

/** Fetches authenticated Hub snapshots and keeps bounded, home-scoped last frames. */
export class HubSnapshot {
  private readonly pending = new Map<string, Promise<CameraSnapshotFrame>>();

  constructor(private readonly dependencies: Dependencies) {}

  async last(entityId: unknown) {
    if (!isCameraId(entityId)) throw new Error('Select a valid camera.');
    const { manager, cache, ensureSession } = this.dependencies;
    if (!manager.bearer()) await ensureSession();
    const home = manager.getSession()?.homeId;
    if (!home) return null;
    const frame = await cache.get(home, entityId);
    return manager.getSession()?.homeId === home ? frame : null;
  }

  async capture(entityId: unknown): Promise<CameraSnapshotFrame> {
    if (!isCameraId(entityId)) throw new Error('Select a valid camera.');
    const { manager, ensureSession } = this.dependencies;
    if (!manager.bearer()) await ensureSession();
    const bearer = manager.bearer();
    const home = manager.getSession()?.homeId;
    if (!bearer || !home) throw new Error('Connect to your Haus Hub first.');

    const key = `${home}\0${entityId}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 8) throw new Error('Camera snapshots are busy; try again shortly.');
    const task = this.download(bearer.url, home, entityId).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  private async download(base: string, home: string, entityId: string) {
    const response = await this.request(base, entityId);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('This camera is not providing a snapshot right now.');
    }

    const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
    const declared = response.headers.get('content-length');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
      (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > SNAPSHOT_LIMIT))
    ) {
      await response.body?.cancel();
      throw new Error('The Hub returned an unsupported snapshot.');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('The Hub returned an empty snapshot.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > SNAPSHOT_LIMIT) throw new Error('The camera snapshot is too large.');
        chunks.push(chunk.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }

    const buffer = Buffer.concat(chunks);
    if (!validImage(buffer, mime)) throw new Error('The Hub returned an invalid snapshot.');
    this.assertCurrent(base, home);
    const receivedAt = Date.now();
    const fresh = response.headers.get('x-haus-snapshot-stale') !== '1';
    const sourceTime = Number(response.headers.get('x-haus-snapshot-captured-at'));
    const cached =
      !fresh && !(sourceTime > 0 && sourceTime <= receivedAt + 5000)
        ? await this.dependencies.cache.get(home, entityId)
        : null;
    const capturedAt =
      sourceTime > 0 && sourceTime <= receivedAt + 5000
        ? sourceTime
        : fresh
          ? receivedAt
          : (cached?.capturedAt ?? cached?.receivedAt ?? 0);
    this.assertCurrent(base, home);
    const image = `data:${mime};base64,${buffer.toString('base64')}`;
    this.dependencies.cache.put(home, entityId, { image, receivedAt, capturedAt });
    return { image, receivedAt, capturedAt, fresh };
  }

  private async request(base: string, entityId: string): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bearer = this.dependencies.manager.bearer();
      if (!bearer || bearer.url !== base) throw new Error('The connected home changed.');
      const response = await this.dependencies.fetchFn(
        `${base}/api/cameras/${encodeURIComponent(entityId)}/snapshot`,
        {
          headers: { authorization: `Bearer ${bearer.token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.status === 401 && attempt === 0 && (await this.dependencies.manager.reconnect()))
        continue;
      return response;
    }
    throw new Error('Your Hub session expired. Connect again.');
  }

  private assertCurrent(base: string, home: string): void {
    const { manager } = this.dependencies;
    if (manager.bearer()?.url !== base || manager.getSession()?.homeId !== home)
      throw new Error('The connected home changed.');
  }
}
