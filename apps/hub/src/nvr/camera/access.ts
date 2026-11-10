/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticator } from '../auth.js';
import { body, json } from '../http.js';
import { cameraAccessKey, cameraId, privateIp } from '@haus/media/camera';

export { cameraAccessKey };

export interface CameraAccessGrant {
  id: string;
  cameraId: string;
  expiresAt: number;
  advertiseHost?: string;
  preRollSeconds?: number;
  requireAudio?: boolean;
  recordAudio?: boolean;
  batteryPowered?: boolean;
  source?: { kind: string; url: string };
}

export interface CameraAccessViewer {
  id?: string;
  sessionId?: string;
  owner?: string;
}

export interface CameraAccessSession {
  id: string;
  state: string;
  expiresAt: number;
}

export interface CameraAccessCameras {
  source: (input: { kind?: unknown; url?: unknown }) => Promise<{ kind: string; url: string }>;
  sessions: Map<string, CameraAccessCameraSession>;
  byCamera: Map<string, CameraAccessCameraSession>;
  status: () => Record<string, unknown>;
  engine: {
    viewers: Map<string, CameraAccessViewer>;
    closeViewer: (id: string, owner: string) => unknown;
  };
  acquire: (input: unknown) => Promise<CameraAccessSession>;
  offer: (
    sessionId: string,
    owner: string,
    offer: string,
  ) => Promise<{ viewerId: string; answer: Record<string, unknown>; candidates?: unknown[] }>;
  release: (sessionId: string, owner: string) => Promise<unknown> | unknown;
}

export interface CameraAccessCameraSession {
  id: string;
  cameraId: string;
  owners: Map<string, number>;
  ring?: { ready: () => boolean };
}

export interface CameraAccessStatus {
  cameraId?: string;
  present?: boolean;
  ready?: boolean;
  [key: string]: unknown;
}

interface CameraAccessOptions {
  now?: () => number;
}

interface CameraClientInput {
  clientSession?: string;
  active?: boolean;
  preview?: boolean;
  viewerId?: string;
  offer?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asCameraClientInput = (value: unknown): CameraClientInput => {
  const record = isRecord(value) ? value : {};
  return {
    clientSession: typeof record.clientSession === 'string' ? record.clientSession : '',
    active: typeof record.active === 'boolean' ? record.active : undefined,
    preview: typeof record.preview === 'boolean' ? record.preview : undefined,
    viewerId: typeof record.viewerId === 'string' ? record.viewerId : '',
    offer: typeof record.offer === 'string' ? record.offer : '',
  };
};

/** An HA-authorized camera capability cannot administer the node or change its source. */
export class CameraAccess {
  private readonly grantsMap = new Map<string, CameraAccessGrant>();
  private readonly authMap = new Map<string, (req: IncomingMessage) => boolean>();
  private readonly viewers = new Map<string, CameraAccessViewer>();
  private readonly closed = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();
  private readonly nowValue: () => number;

  constructor(
    private readonly path: string,
    private readonly key: string,
    private readonly cameras: CameraAccessCameras,
    { now = Date.now }: CameraAccessOptions = {},
  ) {
    this.nowValue = now;
  }

  get grants(): Map<string, CameraAccessGrant> {
    return this.grantsMap;
  }

  async initialize(): Promise<this> {
    try {
      const bytes = await readFile(this.path);
      const decipher = createDecipheriv(
        'aes-256-gcm',
        createHash('sha256').update(this.key).digest(),
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      const values = JSON.parse(
        Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
      );
      if (!Array.isArray(values) || values.length > 256) throw new Error('invalid_camera_access');
      for (const value of values)
        if (value.expiresAt > this.nowValue())
          this.grantsMap.set(String(value.id), {
            id: String(value.id),
            cameraId: String(value.cameraId),
            expiresAt: Number(value.expiresAt),
          });
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT')
        throw new Error('camera_access_could_not_be_unlocked');
    }
    return this;
  }

  persist(): Promise<void> {
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        const iv = randomBytes(12);
        const cipher = createCipheriv(
          'aes-256-gcm',
          createHash('sha256').update(this.key).digest(),
          iv,
        );
        const bytes = Buffer.concat([
          cipher.update(JSON.stringify([...this.grantsMap.values()])),
          cipher.final(),
        ]);
        const temporary = `${this.path}.next`;
        await writeFile(temporary, Buffer.concat([iv, cipher.getAuthTag(), bytes]), {
          mode: 0o600,
        });
        await rename(temporary, this.path);
      });
    this.tail = task;
    return task;
  }

  async provision(input: Record<string, unknown>): Promise<{
    id: string;
    cameraId: string;
    expiresAt: number;
  }> {
    const id = String(input.id ?? '');
    const cameraIdValue = String(input.cameraId ?? '');
    const advertiseHost = String(input.advertiseHost ?? '');
    const expiresAt = Number(input.expiresAt ?? 0);
    const preRollSeconds = Number(input.preRollSeconds ?? 0);
    const requireAudio = Boolean(input.requireAudio);
    const recordAudio = Boolean(input.recordAudio);
    const batteryPowered = Boolean(input.batteryPowered);
    if (
      !/^[a-f0-9]{32}$/.test(id) ||
      !cameraId(cameraIdValue) ||
      !privateIp(advertiseHost) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= this.nowValue() ||
      expiresAt > this.nowValue() + 86400000 ||
      !Number.isInteger(preRollSeconds) ||
      preRollSeconds < 0 ||
      preRollSeconds > 30 ||
      typeof input.requireAudio !== 'boolean' ||
      typeof input.recordAudio !== 'boolean' ||
      typeof input.batteryPowered !== 'boolean'
    )
      throw new Error('invalid_camera_access');
    const sourceInput: { kind?: unknown; url?: unknown } = isRecord(input.source)
      ? input.source
      : {};
    const source = await this.cameras.source(sourceInput);
    const previous = this.grantsMap.get(id);
    if (previous && previous.cameraId !== cameraIdValue) throw new Error('invalid_camera_access');
    for (const [grantId, grant] of this.grantsMap)
      if (grant.expiresAt <= this.nowValue()) {
        this.grantsMap.delete(grantId);
        this.authMap.delete(grantId);
      }
    if (!this.grantsMap.has(id) && this.grantsMap.size >= 256)
      throw new Error('camera_access_busy');
    const value: CameraAccessGrant = {
      id,
      cameraId: cameraIdValue,
      advertiseHost,
      expiresAt,
      preRollSeconds,
      requireAudio,
      recordAudio,
      batteryPowered,
      source: { kind: source.kind, url: source.url },
    };
    this.grantsMap.set(id, value);
    if (!previous || previous.expiresAt !== value.expiresAt) this.authMap.delete(id);
    await this.persist();
    return { id, cameraId: cameraIdValue, expiresAt };
  }

  authenticate(req: IncomingMessage): CameraAccessGrant | undefined {
    const id = req.headers['x-haus-camera-access'];
    const grantId = typeof id === 'string' ? id : undefined;
    const grant = grantId ? this.grantsMap.get(grantId) : undefined;
    if (!grant || grant.expiresAt <= this.nowValue()) return undefined;
    let check = this.authMap.get(grant.id);
    if (!check) {
      check = authenticator(
        cameraAccessKey(this.key, grant.id, grant.cameraId, grant.expiresAt),
        this.nowValue,
      );
      this.authMap.set(grant.id, check);
    }
    return check(req) ? grant : undefined;
  }

  async revoke(id: string): Promise<{ revoked: boolean }> {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('invalid_camera_access');
    this.grantsMap.delete(id);
    this.authMap.delete(id);
    await this.persist();
    for (const session of Array.from(this.cameras.sessions.values()))
      for (const ownerValue of Array.from(session.owners.keys()))
        if (ownerValue.startsWith(`camera-client-${id}-`))
          await this.cameras.release(session.id, ownerValue);
    return { revoked: true };
  }

  async reconcile(input: { cameras?: unknown }): Promise<{ revoked: number }> {
    const cameras = Array.isArray(input?.cameras) ? input.cameras : [];
    if (cameras.length > 256) throw new Error('invalid_camera_access_policy');
    const allowed = new Set(cameras.map((camera) => String(camera)));
    const denied = [...this.grantsMap.values()].filter((grant) => !allowed.has(grant.cameraId));
    for (const grant of denied) await this.revoke(grant.id);
    return { revoked: denied.length };
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!/^\/v1\/client\/camera\/(status|warm|viewer|close)$/.test(path)) return false;
    const grant = this.authenticate(req);
    if (!grant) {
      json(res, 401, { error: 'camera_access_required' });
      return true;
    }
    if (path.endsWith('/status') && req.method === 'GET') {
      const session = this.cameras.byCamera.get(grant.cameraId);
      const status: CameraAccessStatus = {
        cameraId: grant.cameraId,
        present: Boolean(session),
        ready: Boolean(session?.ring?.ready()),
        ...this.cameras.status(),
      };
      json(res, 200, status);
      return true;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const input = asCameraClientInput(await body(req, 72000));
    if (!/^[a-f0-9]{16}$/.test(input.clientSession ?? '')) throw new Error('invalid_camera_client');
    let owner = `camera-client-${grant.id}-${input.clientSession}-viewer`;
    if (path.endsWith('/warm') && input.preview === true)
      owner = `camera-client-${grant.id}-${input.clientSession}-preview`;
    for (const [key, viewer] of this.viewers)
      if (viewer.id && !this.cameras.engine.viewers.has(viewer.id)) this.viewers.delete(key);
    for (const [key, expires] of this.closed)
      if (expires < this.nowValue()) this.closed.delete(key);
    if (path.endsWith('/close')) {
      const viewerId = input.viewerId ?? '';
      if (!/^[a-f0-9-]{36}$/.test(viewerId)) throw new Error('invalid_camera_viewer');
      const key = `${grant.id}:${input.clientSession}:${viewerId}`;
      if (this.closed.size >= 512) {
        const oldest = this.closed.keys().next().value;
        if (oldest !== undefined) this.closed.delete(oldest);
      }
      this.closed.set(key, this.nowValue() + 60000);
      const viewer = this.viewers.get(key);
      this.viewers.delete(key);
      if (viewer?.id) this.cameras.engine.closeViewer(viewer.id, owner);
      json(res, 200, { closed: true });
      return true;
    }
    if (path.endsWith('/warm')) {
      if (
        typeof input.active !== 'boolean' ||
        (input.preview !== undefined && typeof input.preview !== 'boolean')
      )
        throw new Error('invalid_warm_session');
      if (!input.active) {
        const session = this.cameras.byCamera.get(grant.cameraId);
        if (session?.owners.has(owner)) await this.cameras.release(session.id, owner);
        json(res, 200, { warm: false });
        return true;
      }
      if (input.preview && grant.batteryPowered) throw new Error('camera_battery_preview_disabled');
      const acquired = await this.cameras.acquire({ ...grant, owner });
      if (this.grantsMap.get(grant.id)?.expiresAt !== grant.expiresAt) {
        await this.cameras.release(acquired.id, owner);
        throw new Error('camera_access_revoked');
      }
      json(res, 200, {
        warm: true,
        state: acquired.state,
        transport: 'nvr-webrtc',
        expiresAt: acquired.expiresAt,
      });
      return true;
    }
    const viewerId = input.viewerId ?? '';
    const offer = input.offer ?? '';
    if (!/^[a-f0-9-]{36}$/.test(viewerId) || !offer.startsWith('v=0') || offer.length > 64000)
      throw new Error('invalid_camera_viewer');
    const acquiredViewer = await this.cameras.acquire({ ...grant, owner });
    if (this.grantsMap.get(grant.id)?.expiresAt !== grant.expiresAt) {
      await this.cameras.release(acquiredViewer.id, owner);
      throw new Error('camera_access_revoked');
    }
    const key = `${grant.id}:${input.clientSession}:${viewerId}`;
    if (this.closed.has(key)) throw new Error('camera_viewer_closed');
    if (this.viewers.has(key) || this.viewers.size >= 64) throw new Error('camera_viewer_busy');
    const pending: CameraAccessViewer = { id: undefined };
    this.viewers.set(key, pending);
    try {
      const result = await this.cameras.offer(acquiredViewer.id, owner, offer);
      if (this.closed.has(key) || this.grantsMap.get(grant.id)?.expiresAt !== grant.expiresAt) {
        this.cameras.engine.closeViewer(result.viewerId, owner);
        throw new Error('camera_viewer_closed');
      }
      pending.id = result.viewerId;
      json(res, 200, {
        answer: result.answer,
        candidates: result.candidates ?? [],
      });
    } catch (error) {
      this.viewers.delete(key);
      throw error;
    }
    return true;
  }
}
