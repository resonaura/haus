/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import {
  formatFallbackRoomName,
  Identities,
  type HausAutomationRule,
  type HausDevice,
  type HausScene,
  type HausScript,
  type Room,
} from '@haus/core';
import {
  StandaloneHomeEntryEntity,
  type StandaloneHomeEntryRow,
} from '../storage/standalone/entities.js';
import type { Transactions } from '../storage/transactions.js';
import type { InstalledAppEntry } from './app-driver.js';
import type { EndpointHistoryEntry } from './home-stats.js';

export type StandaloneEntryKind =
  | 'device'
  | 'device_alias'
  | 'endpoint_state'
  | 'endpoint_history'
  | 'scene'
  | 'script'
  | 'automation'
  | 'app'
  | 'homekit_pairing'
  | 'ignored_matter_node'
  | 'integration_entry'
  | 'repair_issue'
  | 'tuya_credentials'
  | 'ha_app_credential'
  | 'ha_entry_runtime'
  | 'network_credentials'
  | 'room';

export interface PersistedHomeSnapshot {
  devices: HausDevice[];
  rooms?: Room[];
  aliases?: Array<[string, string]>;
  endpointStates: Array<[string, Record<string, unknown>]>;
  endpointHistory?: Array<[string, EndpointHistoryEntry[]]>;
  scenes: HausScene[];
  scripts: HausScript[];
  automations: HausAutomationRule[];
  apps: Array<[string, InstalledAppEntry]>;
}

export function normalizeScene(scene: HausScene): HausScene {
  const members = (scene.members ?? []).map((member) => {
    const raw = member as object as Record<string, unknown>;
    if (raw.targetState && typeof raw.targetState === 'object') {
      return member;
    }
    const capability = typeof raw.capability === 'string' ? raw.capability : 'state';
    const params = raw.parameters as Record<string, unknown> | undefined;
    const value = params?.value ?? raw.value ?? raw.command;
    return {
      endpointId: String(raw.endpointId ?? ''),
      targetState: { [capability]: value },
    };
  });
  return { ...scene, members };
}

export function normalizeSteps(steps: readonly unknown[]): HausScript['steps'] {
  return (steps ?? []).map((step) => {
    const raw = step as Record<string, unknown>;
    if (raw.type === 'device_command') {
      return {
        type: 'action',
        action: {
          kind: 'device_command',
          payload: {
            endpointId: String(raw.endpointId ?? ''),
            capability: String(raw.capability ?? ''),
            command: String(raw.command ?? 'set'),
            parameters:
              raw.parameters && typeof raw.parameters === 'object'
                ? (raw.parameters as Record<string, unknown>)
                : undefined,
          },
        },
      };
    }
    return step as HausScript['steps'][number];
  });
}

export class StandaloneHomePersistence {
  private readonly pendingSaves = new Map<string, StandaloneHomeEntryRow>();
  private flushTimer?: NodeJS.Timeout;
  private pendingResolvers: Array<() => void> = [];
  private pendingRejecters: Array<(err: unknown) => void> = [];
  private unsubFlush?: () => void;

  constructor(private readonly transactions?: Transactions) {
    this.unsubFlush = transactions?.onFlush(() => this.flush());
  }

  async load(): Promise<PersistedHomeSnapshot> {
    await this.flush();
    const empty: PersistedHomeSnapshot = {
      devices: [],
      rooms: [],
      aliases: [],
      endpointStates: [],
      endpointHistory: [],
      scenes: [],
      scripts: [],
      automations: [],
      apps: [],
    };
    if (!this.transactions) return empty;

    return this.transactions.run(async (manager) => {
      const rows = await manager.find(StandaloneHomeEntryEntity, {
        order: { updatedAt: 'ASC' },
      });
      for (const row of rows) {
        this.decodeRow(row, empty);
      }
      return empty;
    });
  }

  save(kind: StandaloneEntryKind, entryId: string, payload: unknown): Promise<void> {
    if (!this.transactions || !entryId) return Promise.resolve();
    const row: StandaloneHomeEntryRow = {
      kind,
      entryId,
      value: JSON.stringify(payload),
      updatedAt: Date.now(),
    };
    this.pendingSaves.set(`${kind}:${entryId}`, row);
    return new Promise<void>((resolve, reject) => {
      this.pendingResolvers.push(resolve);
      this.pendingRejecters.push(reject);
      if (this.pendingSaves.size >= 50) {
        void this.flush().catch(() => {});
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          void this.flush().catch(() => {});
        }, 25);
        this.flushTimer.unref();
      }
    });
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.pendingSaves.size === 0) {
      const resolvers = this.pendingResolvers;
      this.pendingResolvers = [];
      this.pendingRejecters = [];
      resolvers.forEach((r) => r());
      return;
    }
    const batch = Array.from(this.pendingSaves.values());
    this.pendingSaves.clear();
    const resolvers = this.pendingResolvers;
    const rejecters = this.pendingRejecters;
    this.pendingResolvers = [];
    this.pendingRejecters = [];

    try {
      if (!this.transactions?.dataSource.isInitialized) {
        resolvers.forEach((r) => r());
        return;
      }
      await this.transactions.run(async (manager) => {
        await manager.upsert(StandaloneHomeEntryEntity, batch, ['kind', 'entryId']);
      });
      resolvers.forEach((r) => r());
    } catch (err) {
      if ((err as Error)?.message === 'storage_closed') {
        resolvers.forEach((r) => r());
        return;
      }
      rejecters.forEach((r) => r(err));
      throw err;
    }
  }

  close(): void {
    this.unsubFlush?.();
    this.unsubFlush = undefined;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.pendingSaves.clear();
    const resolvers = this.pendingResolvers;
    this.pendingResolvers = [];
    this.pendingRejecters = [];
    resolvers.forEach((r) => r());
  }

  async remove(kind: StandaloneEntryKind, entryId: string): Promise<void> {
    this.pendingSaves.delete(`${kind}:${entryId}`);
    if (!this.transactions || !entryId) return;
    await this.flush();
    return this.transactions.run(async (manager) => {
      await manager.delete(StandaloneHomeEntryEntity, { kind, entryId });
    });
  }

  async listByKind<T = unknown>(
    kind: StandaloneEntryKind,
  ): Promise<Array<{ entryId: string; value: T }>> {
    if (!this.transactions) return [];
    await this.flush();
    return this.transactions.run(async (manager) => {
      const rows = await manager.find(StandaloneHomeEntryEntity, {
        where: { kind },
        order: { updatedAt: 'ASC' },
      });
      const out: Array<{ entryId: string; value: T }> = [];
      for (const row of rows) {
        try {
          out.push({ entryId: row.entryId, value: JSON.parse(row.value) as T });
        } catch {
          // ignore malformed entry
        }
      }
      return out;
    });
  }

  private decodeRow(row: StandaloneHomeEntryRow, out: PersistedHomeSnapshot): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value) as unknown;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;

    switch (row.kind) {
      case 'device':
        out.devices.push(parsed as HausDevice);
        break;
      case 'room': {
        const candidate = parsed as Partial<Room>;
        if (typeof candidate.id === 'string' && typeof candidate.name === 'string') {
          out.rooms ??= [];
          out.rooms.push({
            id: candidate.id,
            name: candidate.name,
            ...(typeof candidate.icon === 'string' && candidate.icon
              ? { icon: candidate.icon }
              : {}),
          });
        }
        break;
      }
      case 'endpoint_state':
        out.endpointStates.push([row.entryId, parsed as Record<string, unknown>]);
        break;
      case 'endpoint_history':
        if (Array.isArray(parsed)) {
          out.endpointHistory ??= [];
          out.endpointHistory.push([row.entryId, parsed as EndpointHistoryEntry[]]);
        }
        break;
      case 'scene':
        out.scenes.push(parsed as HausScene);
        break;
      case 'script':
        out.scripts.push(parsed as HausScript);
        break;
      case 'automation':
        out.automations.push(parsed as HausAutomationRule);
        break;
      case 'app':
        out.apps.push([row.entryId, parsed as InstalledAppEntry]);
        break;
      case 'device_alias': {
        const canonicalId =
          parsed && typeof parsed === 'object' && 'canonicalId' in parsed
            ? (parsed as { canonicalId?: unknown }).canonicalId
            : undefined;
        if (typeof canonicalId === 'string' && canonicalId.length > 0) {
          out.aliases ??= [];
          out.aliases.push([row.entryId, canonicalId]);
        }
        break;
      }
      default:
        break;
    }
  }
}

export async function applyHomeSnapshot(
  snapshot: PersistedHomeSnapshot,
  target: {
    devices: { registerDevice: (d: HausDevice) => HausDevice };
    rooms?: Map<string, Room>;
    roomCoordinator: {
      registerRoom?: (r: Room) => Promise<unknown>;
      registerDevice: (d: HausDevice) => Promise<unknown>;
      registerAlias?: (alias: string, canonicalId: string) => Promise<unknown>;
      putScene: (s: HausScene) => Promise<unknown>;
      putScript: (s: HausScript) => Promise<unknown>;
      putAutomation: (a: HausAutomationRule) => Promise<unknown>;
    };
    endpointStates: Map<string, Record<string, unknown>>;
    scenes: Map<string, HausScene>;
    scripts: Map<string, HausScript>;
    automations: Map<string, HausAutomationRule>;
    automationEngine: { updateRule: (r: HausAutomationRule) => void };
    installedApps: Map<string, InstalledAppEntry>;
  },
): Promise<void> {
  for (const room of snapshot.rooms ?? []) {
    if (!room.id || room.id === 'unassigned') continue;
    const normalizedRoom: Room = {
      id: room.id,
      name: room.name,
      ...(room.icon ? { icon: room.icon } : {}),
    };
    target.rooms?.set(normalizedRoom.id, normalizedRoom);
    if (typeof target.roomCoordinator.registerRoom === 'function') {
      await target.roomCoordinator.registerRoom(normalizedRoom);
    }
  }
  for (const dev of snapshot.devices) {
    const normalized = target.devices.registerDevice(dev);
    if (
      normalized.roomId &&
      normalized.roomId !== 'unassigned' &&
      target.rooms &&
      !target.rooms.has(normalized.roomId)
    ) {
      const seeded: Room = {
        id: normalized.roomId,
        name: formatFallbackRoomName(normalized.roomId),
      };
      target.rooms.set(seeded.id, seeded);
      if (typeof target.roomCoordinator.registerRoom === 'function') {
        await target.roomCoordinator.registerRoom(seeded);
      }
    }
    await target.roomCoordinator.registerDevice(normalized);
  }
  for (const [epId, state] of snapshot.endpointStates) {
    target.endpointStates.set(epId, state);
  }
  for (const scene of snapshot.scenes) {
    const normalized = normalizeScene(scene);
    target.scenes.set(normalized.id, normalized);
    await target.roomCoordinator.putScene(normalized);
  }
  for (const script of snapshot.scripts) {
    target.scripts.set(script.id, script);
    await target.roomCoordinator.putScript(script);
  }
  for (const rule of snapshot.automations) {
    target.automations.set(rule.id, rule);
    await target.roomCoordinator.putAutomation(rule);
    target.automationEngine.updateRule(rule);
  }
  for (const [appId, entry] of snapshot.apps) {
    target.installedApps.set(appId, entry);
  }
  if (typeof target.roomCoordinator.registerAlias === 'function') {
    for (const [alias, canonicalId] of snapshot.aliases ?? []) {
      await target.roomCoordinator.registerAlias(alias, canonicalId);
    }
  }
}

/** Creates an isolated app-identity mapper backed by an in-memory map. */
export function createAppIdentities(): Identities {
  const identityMap = new Map<string, string>();
  return new Identities(
    {
      get: (s) => identityMap.get(`${s.instanceId}:${s.externalId}`),
      putIfAbsent: (s, id) => {
        const k = `${s.instanceId}:${s.externalId}`;
        const ex = identityMap.get(k);
        if (ex) return ex;
        identityMap.set(k, id);
        return id;
      },
    },
    () => `app-${randomUUID()}`,
  );
}
